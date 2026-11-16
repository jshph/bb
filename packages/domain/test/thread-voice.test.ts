import { expect, it } from "vitest";
import { threadVoiceCommandSchema } from "../src/thread-voice.js";

const start = {
  action: "start",
  sessionId: "11111111-1111-4111-8111-111111111111",
  sdp: "offer",
};
it("accepts default omission and supported v3 voices, rejects other catalogs and midcall changes", () => {
  expect(threadVoiceCommandSchema.parse(start)).toEqual(start);
  for (const voice of [
    "arbor",
    "breeze",
    "cove",
    "ember",
    "juniper",
    "maple",
    "sol",
    "spruce",
    "vale",
  ]) {
    expect(
      threadVoiceCommandSchema.parse({ ...start, experimental_voice: voice }),
    ).toMatchObject({ experimental_voice: voice });
  }
  for (const voice of ["marin", "cedar", "default", "unknown", "", null]) {
    expect(
      threadVoiceCommandSchema.safeParse({
        ...start,
        experimental_voice: voice,
      }).success,
    ).toBe(false);
  }
  expect(
    threadVoiceCommandSchema.safeParse({
      action: "keepAlive",
      sessionId: start.sessionId,
      experimental_voice: "cove",
    }).success,
  ).toBe(false);
});
