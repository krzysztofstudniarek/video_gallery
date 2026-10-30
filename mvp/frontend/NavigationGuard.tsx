import { useBeforeUnload, useBlocker } from "react-router";
import { useCallback, useEffect, useRef } from "react";

export function NavigationGuard({ when, message }: { when: boolean; message: string }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    when && currentLocation.pathname !== nextLocation.pathname
  );
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (blocker.state === "blocked") title.current?.focus();
  }, [blocker.state]);
  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => {
    if (when) {
      event.preventDefault();
      event.returnValue = "";
    }
  }, [when]));
  if (blocker.state !== "blocked") return null;
  return (
    <section role="alert" aria-label="Leave this screen?">
      <h2 ref={title} tabIndex={-1}>Leave this screen?</h2>
      <p>{message}</p>
      <button type="button" onClick={() => blocker.reset()}>Stay here</button>
      <button type="button" onClick={() => blocker.proceed()}>Leave screen</button>
    </section>
  );
}
