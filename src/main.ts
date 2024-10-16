import { Relay } from "nostr-tools/relay";
import { npubEncode, neventEncode, noteEncode, naddrEncode } from "nostr-tools/nip19";
import { Event } from "nostr-tools/pure";
import { associateBy } from "@std/collections/associate-by";
import lightBolt11Decoder from 'light-bolt11-decoder'

const relayUri = Deno.args[0]
  ? `wss://${Deno.args[0]}`
  : "wss://relay.nostr.band";

const getTag = (event: Event, tag: string) => event.tags.find((t) => t[0] === tag);

const extractAmountInSats = (invoice: string) => {
  try {
    const sections = associateBy(lightBolt11Decoder
        .decode(invoice)
        .sections, ({ name }) => name)
    const amountSection = sections['amount'] as { name: "amount"; letters: string; value: string }

    return Number(amountSection.value) / 1000
  } catch (err) {
    console.error(err);
    return 0;
  }
};

const getZappedEventNip19Id = (zapReceiptEvent: Event) => {
  try {
    const eTag = getTag(zapReceiptEvent, "e");

    if (eTag) {
      return noteEncode(eTag[1]);
    } else {
      const aTag = getTag(zapReceiptEvent, "a");
      const [kind, pubkey, identifier] = aTag?.[1].split(":") ?? [];
      const recommendedRelay = aTag?.[2] ?? relayUri;

      return naddrEncode({
        pubkey,
        identifier,
        kind: Number(kind),
        relays: [recommendedRelay],
      });
    }
  } catch (err) {
    console.error(err);
    console.log(zapReceiptEvent);
    return null;
  }
};

const getZapEvent = (event: Event) => {
  try {
    return JSON.parse(getTag(event, "description")?.[1] ?? "");
  } catch (err) {
    console.error(err);
    console.log(event);
    return null;
  }
};

const getZapperPubkey = (zapReceiptEvent: Event) => {
  const zapEvent = getZapEvent(zapReceiptEvent);

  return zapEvent ? zapEvent.pubkey : null;
};

const normalizeZapReceiptEvents = (zapReceiptEvents: Event[]) => {
  return zapReceiptEvents.map((event) => {
    const zapEvent = getZapEvent(event);
    const zapperNpub = zapEvent ? npubEncode(zapEvent.pubkey) : null;
    const zapAmount = extractAmountInSats(getTag(event, "bolt11")?.[1] ?? '');
    const comment = zapEvent?.content;
    const zappedNip19Id = getZappedEventNip19Id(event);
    const isAnonZap = zapEvent ? Boolean(getTag(zapEvent, "anon")) : false;

    return {
      zapperNpub,
      zapAmount,
      comment,
      zappedNip19Id,
      isAnonZap,
      zapReceiptId: neventEncode({ id: event.id, relays: [relayUri] }),
    };
  });
};

const start = async () => {
  const relay = await Relay.connect(relayUri);
  const numberOfEvents = 10;
  const zapReceiptEvents: Event[] = [];

  const sub = relay.subscribe(
    [
      {
        kinds: [9735],
        since: Math.floor(Date.now() / 1000) - 12 * 60 * 60,
      },
    ],
    {
      onevent(event) {
        const zapperPubkey = getZapperPubkey(event);
        const isSelfZap = zapperPubkey === getTag(event, "p")?.[1];

        if (!isSelfZap && (getTag(event, "a") || getTag(event, "e"))) {
          zapReceiptEvents.push(event);
        }
      },
      oneose() {
        const results = normalizeZapReceiptEvents(zapReceiptEvents);

        results.sort((a, b) => a.zapAmount - b.zapAmount);
        results
          .filter(
            ({ zapperNpub, zappedNip19Id }) =>
              zapperNpub !== null && zappedNip19Id !== null,
          )
          .slice(-numberOfEvents)
          .forEach(
            ({
              zapperNpub,
              zapAmount,
              comment,
              zappedNip19Id,
              isAnonZap,
              zapReceiptId,
            }) => {
              const normalizedZapper = isAnonZap
                ? "Anonymous"
                : `nostr:${zapperNpub}`;
              const normalizedComment =
                comment.length === 0 ? comment : `"${comment}"\n\n`;
              const normalizedLink = zappedNip19Id?.startsWith("naddr1")
                ? `https://njump.me/${zappedNip19Id}`
                : `nostr:${zappedNip19Id}`;
              console.log(zapReceiptId);

              console.log(
                `${normalizedZapper} zapped ⚡️${zapAmount.toLocaleString()} sats\n\n${normalizedComment}${normalizedLink}\n\n\n\n`,
              );
            },
          );
        Deno.exit(0);
      },
    },
  );
};

start().catch(console.error);
