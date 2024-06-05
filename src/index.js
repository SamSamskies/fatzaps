const { useWebSocketImplementation, Relay } = require("nostr-tools/relay");
const { npubEncode, noteEncode } = require("nostr-tools/nip19");
const lightBolt11Decoder = require("light-bolt11-decoder");

useWebSocketImplementation(require("ws"));

const relayUri = "wss://relay.nostr.band";

const getTag = (event, tag) => event.tags.find((t) => t[0] === tag);

const getEventAuthorNpub = (event) => npubEncode(event.pubkey);

const extractAmountInSats = (invoice) => {
  return (
    lightBolt11Decoder
      .decode(invoice)
      .sections.find(({ name }) => name === "amount").value / 1000
  );
};

const getZappedEventNoteId = (event) => noteEncode(getTag(event, "e")[1]);

const getZapEvent = (event) => {
  try {
    return JSON.parse(getTag(event, "description")[1]);
  } catch (err) {
    console.error(err);
    return null;
  }
};

const normalizeZapReceiptEvents = (zapReceiptEvents) => {
  return zapReceiptEvents.map((event) => {
    const zapEvent = getZapEvent(event);
    const zapperNpub = zapEvent ? getEventAuthorNpub(zapEvent) : null;
    const zapAmount = extractAmountInSats(getTag(event, "bolt11")[1]);
    const comment = zapEvent?.content;
    const zappedNoteId = getZappedEventNoteId(event);

    return { zapperNpub, zapAmount, comment, zappedNoteId };
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
        since: Math.floor(Date.now() / 1000) - 12 * 60 * 60, // last 4 hours
      },
    ],
    {
      onevent(event) {
        if (getTag(event, "e")) {
          zapReceiptEvents.push(event);
        }
      },
      oneose() {
        sub.close();
        relay.close();

        const results = normalizeZapReceiptEvents(zapReceiptEvents);

        results.sort((a, b) => a.zapAmount - b.zapAmount);

        results
          .filter(({ zapperNpub }) => zapperNpub !== null)
          .slice(-numberOfEvents)
          .forEach(({ zapperNpub, zapAmount, comment, zappedNoteId }) => {
            const normalizedComment =
              comment.length === 0 ? comment : `"${comment}"\n\n`;

            console.log(
              `nostr:${zapperNpub} zapped ⚡️${zapAmount.toLocaleString()} sats\n\n${normalizedComment}nostr:${zappedNoteId}\n\n\n\n`,
            );
          });
      },
    },
  );
};

try {
  start();
} catch (err) {
  console.error(err);
}
