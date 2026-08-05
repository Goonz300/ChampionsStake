import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listSessionsForUser, type SessionListItem } from "@/lib/auth/session-registry";
import { listDevicesForUser } from "@/lib/auth/device";
import { RevokeOthersButton } from "@/components/settings/RevokeOthersButton";

/**
 * Security Settings — Phase 3 Architecture Rev. 2, §8/§11/§17 (M2). Shows
 * exactly the real, RLS-scoped data this stack actually has: sessions and
 * devices are read-only rows here, not editable ones — `devices` has no
 * client write policy at all (0018), and there is no per-session revoke
 * capability anywhere in this stack (§8), only "sign out everything but
 * this session." No trust toggles, nicknames, per-row remove buttons, or
 * location fields are rendered: none of those are backed by real schema or
 * architecture, and this phase does not invent them (Phase 3B scope note).
 */
export default async function SecuritySettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const [{ data: sessions }, { data: devices }] = await Promise.all([
    listSessionsForUser(supabase, session?.refresh_token),
    listDevicesForUser(supabase),
  ]);

  const now = Date.now();
  const isActive = (s: SessionListItem) =>
    s.revoked_at === null && new Date(s.expires_at).getTime() > now;
  const activeSessions = sessions.filter(isActive);
  const historicalSessions = sessions.filter((s) => !isActive(s));
  const currentSession = sessions.find((s) => s.is_current);
  const lastLogin =
    sessions.find((s) => !s.is_current)?.created_at ?? currentSession?.created_at ?? null;

  return (
    <main className="bg-vv-black min-h-screen p-4 text-white sm:p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="font-orbitron text-vv-neon-green text-2xl font-bold">Security Settings</h1>
        <p className="font-exo text-vv-text-tertiary mt-2 text-sm">
          Sessions and devices associated with your account.
        </p>

        {lastLogin ? (
          <p className="font-exo text-vv-text-secondary mt-4 text-sm">
            Last login: <span className="text-white">{new Date(lastLogin).toLocaleString()}</span>
          </p>
        ) : null}

        <section aria-labelledby="active-sessions-heading" className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2
              id="active-sessions-heading"
              className="font-orbitron text-lg font-semibold text-white"
            >
              Active Sessions
            </h2>
            <RevokeOthersButton />
          </div>
          <SessionsTable
            sessions={activeSessions}
            devices={devices}
            emptyLabel="No active sessions."
          />
        </section>

        <section aria-labelledby="known-devices-heading" className="mt-10">
          <h2 id="known-devices-heading" className="font-orbitron text-lg font-semibold text-white">
            Known Devices
          </h2>
          <p className="font-exo text-vv-text-tertiary mt-1 text-xs">
            Devices are recorded automatically at login and shown for review only — this list is not
            individually editable.
          </p>
          <div className="border-vv-divider mt-3 overflow-x-auto rounded border">
            <table className="font-exo w-full min-w-[480px] text-left text-sm">
              <caption className="sr-only">Known devices on your account</caption>
              <thead>
                <tr className="border-vv-divider text-vv-text-tertiary border-b text-xs uppercase">
                  <th scope="col" className="px-4 py-2 font-medium">
                    Device
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    First seen
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Last active
                  </th>
                </tr>
              </thead>
              <tbody>
                {devices.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="text-vv-text-tertiary px-4 py-4">
                      No known devices.
                    </td>
                  </tr>
                ) : (
                  devices.map((device) => (
                    <tr key={device.id} className="border-vv-divider border-b last:border-0">
                      <td className="text-vv-text-secondary px-4 py-2">
                        {describeUserAgent(device.user_agent)}
                        {currentSession?.device_id === device.id ? (
                          <span className="bg-vv-neon-green/10 text-vv-neon-green ml-2 rounded px-2 py-0.5 text-xs">
                            This device
                          </span>
                        ) : null}
                      </td>
                      <td className="text-vv-text-secondary px-4 py-2">
                        {new Date(device.first_seen_at).toLocaleDateString()}
                      </td>
                      <td className="text-vv-text-secondary px-4 py-2">
                        {new Date(device.last_seen_at).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="session-history-heading" className="mt-10">
          <h2
            id="session-history-heading"
            className="font-orbitron text-lg font-semibold text-white"
          >
            Session History
          </h2>
          <SessionsTable
            sessions={historicalSessions}
            devices={devices}
            emptyLabel="No past sessions yet."
          />
        </section>
      </div>
    </main>
  );
}

function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  // Pragmatic v1 label, matching device.ts's own "not a full
  // browser-fingerprinting solution" scope note — real UA parsing would be
  // a new dependency this phase does not introduce.
  return userAgent.length > 60 ? `${userAgent.slice(0, 57)}…` : userAgent;
}

function sessionStatusLabel(session: SessionListItem): { text: string; className: string } {
  if (session.revoked_at) return { text: "Revoked", className: "text-vv-loss-red" };
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    return { text: "Expired", className: "text-vv-text-tertiary" };
  }
  return { text: "Active", className: "text-vv-success-green" };
}

function SessionsTable({
  sessions,
  devices,
  emptyLabel,
}: {
  sessions: SessionListItem[];
  devices: { id: string; user_agent: string | null }[];
  emptyLabel: string;
}) {
  const deviceLabel = (deviceId: string | null) => {
    if (!deviceId) return "Unknown device";
    const device = devices.find((d) => d.id === deviceId);
    return describeUserAgent(device?.user_agent ?? null);
  };

  return (
    <div className="border-vv-divider mt-3 overflow-x-auto rounded border">
      <table className="font-exo w-full min-w-[560px] text-left text-sm">
        <caption className="sr-only">Your sessions</caption>
        <thead>
          <tr className="border-vv-divider text-vv-text-tertiary border-b text-xs uppercase">
            <th scope="col" className="px-4 py-2 font-medium">
              Device
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              IP address
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Started
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {sessions.length === 0 ? (
            <tr>
              <td colSpan={4} className="text-vv-text-tertiary px-4 py-4">
                {emptyLabel}
              </td>
            </tr>
          ) : (
            sessions.map((s) => {
              const status = sessionStatusLabel(s);
              return (
                <tr key={s.id} className="border-vv-divider border-b last:border-0">
                  <td className="text-vv-text-secondary px-4 py-2">
                    {deviceLabel(s.device_id)}
                    {s.is_current ? (
                      <span className="bg-vv-neon-green/10 text-vv-neon-green ml-2 rounded px-2 py-0.5 text-xs">
                        This session
                      </span>
                    ) : null}
                  </td>
                  <td className="text-vv-text-secondary px-4 py-2">{s.ip_address ?? "—"}</td>
                  <td className="text-vv-text-secondary px-4 py-2">
                    {new Date(s.created_at).toLocaleString()}
                  </td>
                  <td className={`px-4 py-2 font-medium ${status.className}`}>{status.text}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
