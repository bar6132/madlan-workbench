// Failure simulator and diagnostic detail are off unless NEXT_PUBLIC_ENABLE_DEBUG=1 (local demos, preview deploys).
// Read at call time so tests can toggle it. Public production leaves it unset: ?debug=1 then does nothing.
export function debugEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_DEBUG === '1';
}
