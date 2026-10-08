// Request builders shared by the app and its fixed-workload performance checks.
import { noul } from "./jev.js";

export function placeRequest(wish, batch, contexts = null) {
  const state = {
    wish,
    // Keyed, not an array. Measured on 240 places: `places[i]` is 100% right at 15 per request,
    // 95% at 30 and 75% at 60, because Jev has to count to the index. `places.place_i` stays at 99%+.
    places: Object.fromEntries(
      batch.map((p, i) => [`place_${i}`, { name: p.name, ...p.tags, ...(contexts ? { street_view: contexts.get(p.id) } : {}) }]),
    ),
  };
  const questions = {};
  batch.forEach((_, i) => {
    if (!contexts) {
      questions[`p${i}`] = noul(
        `Would \`places.place_${i}\` be a good place to go for someone whose wish is \`wish\`? Ignore any part of the wish about location, distance or walking time: that is already handled.`,
        "The place plausibly satisfies the wish",
        "The place does not offer what the wish asks for",
      );
      return;
    }
    questions[`fit${i}`] = noul(
      `Leave the street outside aside. Is \`places.place_${i}\` itself the kind of place that suits someone whose wish is \`wish\`?`,
      "The place itself, by its type and details, suits the wish",
      "The place itself does not suit the wish",
    );
    questions[`street${i}`] = noul(
      `\`places.place_${i}.street_view\` lists what street-level photos show within 50 metres. Does that street suit someone whose wish is \`wish\`?`,
      "The street surroundings clearly help with the wish",
      "The street surroundings do not help, or work against the wish",
    );
  });
  return { state, questions };
}

export function gameRequest(question, batch, askable = false) {
  return {
    state: { question, places: Object.fromEntries(batch.map((p, i) => [`place_${i}`, { name: p.name, ...p.tags }])) },
    questions: {
      ...Object.fromEntries(batch.map((_, i) => [`p${i}`, noul(
        `Someone asks \`question\` about \`places.place_${i}\`. Is the honest answer yes?`,
        "Yes, judging by what kind of place it is and what is known about it", "No, or very unlikely",
      )])),
      ...(askable ? { askable: askableQuestion() } : {}),
    },
  };
}

export const askableQuestion = () => noul(
  "Can `question` be answered yes or no about one particular place? Requests to choose which place, list places, explain something, or tell a story are not yes/no questions.",
  "A yes/no question about a particular place, its type, features or services",
  "An open-ended question, a request to pick or list places, a command, or an unrelated topic",
);

/** Keep local batches bounded; hosted batches retain their parallel fan-out. */
export async function mapBatches(items, size, run, serial = false) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  if (!serial) return Promise.all(batches.map(run));
  const results = [];
  for (const [i, batch] of batches.entries()) results.push(await run(batch, i));
  return results;
}
