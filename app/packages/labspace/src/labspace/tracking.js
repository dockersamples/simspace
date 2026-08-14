// Resolves the effective tracking config for one lab from two inputs:
//
//   base   — the deployment-level default (from config.json, §AppConfigContext).
//            Set once per deployment; typically the only place the endpoint lives.
//   lab    — the lab's own directive from its labspace.yaml `tracking:` field:
//              undefined  → inherit the base (tracked by default)
//              false      → explicit opt-out (no tracking for this lab)
//              { ... }    → overrides merged over the base (e.g. presence: false,
//                           or a different endpoint — rarely needed)
//
// Returns the resolved config { endpoint, labId, presence, identity } when
// tracking is on, or null when it's off (opted out, or no endpoint anywhere).
export function resolveTracking(base, lab, labId) {
  if (lab === false) return null; // explicit opt-out

  const merged = {
    ...(base && typeof base === "object" ? base : {}),
    ...(lab && typeof lab === "object" ? lab : {}),
  };

  if (!merged.endpoint) return null; // nothing configured → tracking off

  return {
    endpoint: String(merged.endpoint).replace(/\/+$/, ""),
    labId: merged.labId || labId,
    // presence UI defaults on; only an explicit `false` disables it.
    presence: merged.presence !== false,
    // identity defaults to optional-name; only "anonymous" opts out of names.
    identity: merged.identity === "anonymous" ? "anonymous" : "optional-name",
  };
}
