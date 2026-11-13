import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Emit a change computed from the state the host has COMMITTED, once the
 * updates it queued have rendered.
 *
 * A surface that awaits a host callback (`onEnroll`, `onRevoke`, ...) and then
 * emits `{ ...value, status: "idle" }` builds that object from the value it
 * last RENDERED. If the host wrote into the same bound state inside the
 * callback (the README's own `onEnroll` does: `setState((prev) => ...)`), that
 * write is queued but not yet rendered, so the emission is stale, and a host
 * whose `onChange` is `setState` takes it as the whole next state. The write
 * is lost. That is how the manager dropped a passkey it had just enrolled
 * (found by the `passkeys` lab benchmark, 2026-11-13).
 *
 * `settle(apply)` instead schedules a render of this component, which React
 * batches with whatever the host already queued, and calls
 * `onChange(apply(latest))` from an effect after that render commits. The
 * emission is still the FULL next state, as the contract says; it is just
 * built from the right one.
 */
export function useSettledChange<T>(value: T, onChange: (next: T) => void): {
  latest: { readonly current: T };
  settle: (apply: (current: T) => T) => void;
} {
  const latest = useRef(value);
  latest.current = value;

  const pending = useRef<Array<(current: T) => T>>([]);
  const [tick, setTick] = useState(0);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (pending.current.length === 0) {
      return;
    }
    const queued = pending.current;
    pending.current = [];
    let next = latest.current;
    for (const apply of queued) {
      next = apply(next);
    }
    latest.current = next;
    onChangeRef.current(next);
  }, [tick]);

  const settle = useCallback((apply: (current: T) => T) => {
    pending.current.push(apply);
    setTick((n) => n + 1);
  }, []);

  return { latest, settle };
}
