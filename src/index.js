const { useWebSocketImplementation, Relay } = require("nostr-tools/relay");
const { npubEncode, noteEncode, naddrEncode } = require("nostr-tools/nip19");
const lightBolt11Decoder = require("light-bolt11-decoder");

useWebSocketImplementation(require("ws"));

const relayUri = "wss://relay.nostr.band";

const getTag = (event, tag) => event.tags.find((t) => t[0] === tag);

const extractAmountInSats = (invoice) => {
  try {
    return (
      lightBolt11Decoder
        .decode(invoice)
        .sections.find(({ name }) => name === "amount").value / 1000
    );
  } catch (err) {
    console.error(err);
    return 0;
  }
};

const getZappedEventNip19Id = (zapReceiptEvent) => {
  try {
    const eTag = getTag(zapReceiptEvent, "e");

    if (eTag) {
      return noteEncode(eTag[1]);
    } else {
      const aTag = getTag(zapReceiptEvent, "a");
      const [kind, pubkey, identifier] = aTag[1].split(":");
      const recommendedRelay = aTag[2] ?? relayUri;

      return naddrEncode({
        pubkey,
        identifier,
        kind,
        relays: [recommendedRelay],
      });
    }
  } catch (err) {
    console.error(err);
    console.log(zapReceiptEvent);
    return null;
  }
};

const getZapEvent = (event) => {
  try {
    return JSON.parse(getTag(event, "description")[1]);
  } catch (err) {
    console.error(err);
    console.log(event);
    return null;
  }
};

const getZapperPubkey = (zapReceiptEvent) => {
  const zapEvent = getZapEvent(zapReceiptEvent);

  return zapEvent ? zapEvent.pubkey : null;
};

const normalizeZapReceiptEvents = (zapReceiptEvents) => {
  return zapReceiptEvents.map((event) => {
    const zapEvent = getZapEvent(event);
    const zapperNpub = zapEvent ? npubEncode(zapEvent.pubkey) : null;
    const zapAmount = extractAmountInSats(getTag(event, "bolt11")[1]);
    const comment = zapEvent?.content;
    const zappedNip19Id = getZappedEventNip19Id(event);
    const isAnonZap = zapEvent ? Boolean(getTag(zapEvent, "anon")) : false;

    return {
      zapperNpub,
      zapAmount,
      comment,
      zappedNip19Id,
      isAnonZap,
    };
  });
};

const start = async () => {
  const relay = await Relay.connect(relayUri);
  const numberOfEvents = 10;
  const zapReceiptEvents = [];

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
        const isSelfZap = zapperPubkey === getTag(event, "p")[1];

        if (!isSelfZap && (getTag(event, "a") || getTag(event, "e"))) {
          zapReceiptEvents.push(event);
        }
      },
      oneose() {
        sub.close();
        relay.close();

        const results = normalizeZapReceiptEvents(zapReceiptEvents);

        results.sort((a, b) => a.zapAmount - b.zapAmount);

        results
          .filter(
            ({ zapperNpub, zappedNip19Id }) =>
              zapperNpub !== null && zappedNip19Id !== null,
          )
          .slice(-numberOfEvents)
          .forEach(
            ({ zapperNpub, zapAmount, comment, zappedNip19Id, isAnonZap }) => {
              const normalizedZapper = isAnonZap
                ? "Anonymous"
                : `nostr:${zapperNpub}`;
              const normalizedComment =
                comment.length === 0 ? comment : `"${comment}"\n\n`;
              const normalizedLink = zappedNip19Id.startsWith("naddr1")
                ? `https://njump.me/${zappedNip19Id}`
                : `nostr:${zappedNip19Id}`;

              console.log(
                `${normalizedZapper} zapped ⚡️${zapAmount.toLocaleString()} sats\n\n${normalizedComment}${normalizedLink}\n\n\n\n`,
              );
            },
          );
      },
    },
  );
};

start().catch(console.error);
