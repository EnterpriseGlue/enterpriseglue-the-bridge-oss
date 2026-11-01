import React from 'react';
import { getBrowserSessionRevision } from '../../../utils/browserSession';

// Client continuation ownership only. The API authorizes every request.
export function useProjectActionFence(scope: string) {
  const life = React.useRef({ scope, epoch: 0, browser: getBrowserSessionRevision() });
  if (life.current.scope !== scope) life.current = { scope, epoch: life.current.epoch + 1, browser: getBrowserSessionRevision() };
  const mounted = React.useRef(true), active = React.useRef<object | null>(null);
  const uncertain = React.useRef(false);
  const [pending, setPending] = React.useState(false);
  const [blocked, setBlocked] = React.useState(false);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false;  } }, []);
  React.useEffect(() => { active.current = null; uncertain.current = false; setPending(false); setBlocked(false); }, [scope]);
  const { epoch, browser } = life.current;
  const capture = () => {
    return () => { if (!mounted.current || life.current.scope !== scope || life.current.epoch !== epoch || browser !== getBrowserSessionRevision()) throw new Error('Project action context changed'); };
  };
  const begin = (allowed: boolean) => {
    const check = capture();
    try { check(); } catch { return null; }
    if (!allowed || active.current || uncertain.current) return null;
    const token = {}; active.current = token; setPending(true);
    return { check, markUncertain: () => { try { check(); uncertain.current = true; setBlocked(true); } catch {} }, finish: () => { if (active.current === token) { active.current = null; if (mounted.current) setPending(false); } } };
  };
  return { capture, begin, pending, blocked };
}
