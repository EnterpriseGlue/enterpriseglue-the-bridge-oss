import { useEffect, useRef } from 'react';

type Turnstile = {
  render(element: HTMLElement, options: {
    sitekey: string;
    action: string;
    callback(token: string): void;
    'expired-callback'(): void;
    'error-callback'(): void;
  }): string;
  remove(id: string): void;
};
type TurnstileWindow = Window & { turnstile?: Turnstile };
const source = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<Turnstile> | undefined;

function loadTurnstile(): Promise<Turnstile> {
  const current = (window as TurnstileWindow).turnstile;
  if (current) return Promise.resolve(current);
  if (loading) return loading;
  loading = new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = source;
    script.async = true;
    script.onload = () => {
      const loaded = (window as TurnstileWindow).turnstile;
      if (loaded) resolve(loaded);
      else reject(Error('Email signup verification unavailable'));
    };
    script.onerror = () => {
      script.remove();
      reject(Error('Email signup verification unavailable'));
    };
    document.head.append(script);
  }).catch(error => {
    loading = undefined;
    throw error;
  });
  return loading;
}

export default function EmailSignupTurnstile({ siteKey, onToken, onError }: {
  siteKey: string;
  onToken(token: string | null): void;
  onError(): void;
}) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let mounted = true;
    let widget: { api: Turnstile; id: string } | undefined;
    void loadTurnstile().then(api => {
      if (!mounted || !element.current) return;
      const id = api.render(element.current, {
        sitekey: siteKey,
        action: 'cloud_email_signup',
        callback: token => { if (mounted) onToken(token); },
        'expired-callback': () => { if (mounted) onToken(null); },
        'error-callback': () => { if (mounted) { onToken(null); onError(); } },
      });
      widget = { api, id };
    }).catch(() => { if (mounted) onError(); });
    return () => {
      mounted = false;
      if (widget) widget.api.remove(widget.id);
    };
  }, [siteKey, onToken, onError]);
  return <div ref={element} />;
}
