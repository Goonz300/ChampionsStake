// supabase/functions/_realtime/typing.ts
//
// Typing indicators are the clearest example of something that should
// NEVER touch Postgres: they're valid for a few seconds, apply to exactly
// one channel (a challenge's chat), and persisting them would be pure
// write overhead with zero read value a moment later. This uses Supabase
// Realtime's Broadcast feature directly -- a message sent to everyone
// subscribed to a channel, with no database round-trip and no storage.
//
// This module is intentionally thin: the actual broadcast call is normally
// made directly from the authenticated client for lowest latency, since
// round-tripping through an Edge Function adds latency for a signal whose
// entire value is being instantaneous. The typing-update Edge Function
// exists for callers that specifically want server-validated authorization
// (only real participants may broadcast into a challenge's typing channel)
// at the cost of that extra hop -- documented as a deliberate tradeoff, not
// an oversight.

import { getServiceRoleClient } from "../_shared/database/client.ts";
import { AuthorizationError } from "../_shared/errors/index.ts";
import { isParticipant } from "../_challenge/repository.ts";

export async function broadcastTyping(
  challengeId: string,
  userId: string,
  isTyping: boolean,
): Promise<void> {
  if (!(await isParticipant(challengeId, userId))) {
    throw new AuthorizationError(
      "Only challenge participants may broadcast typing status.",
    );
  }

  const supabase = getServiceRoleClient();
  const channel = supabase.channel(`chat:${challengeId}`);
  await channel.send({
    type: "broadcast",
    event: isTyping ? "typing_started" : "typing_stopped",
    payload: { userId, challengeId, timestamp: new Date().toISOString() },
  });
  // No further cleanup needed -- Broadcast messages are fire-and-forget,
  // never stored. A client-side timeout (recommended: 3-5 seconds of
  // silence) is what turns a stale "typing_started" into an implicit stop
  // on the RECEIVING client, since this server never tracks who is
  // "currently" typing.
}
