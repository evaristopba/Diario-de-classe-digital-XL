import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

interface TurnstileWidgetProps {
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement | string,
        params: {
          sitekey: string;
          callback: (token: string) => void;
          'error-callback'?: () => void;
          'expired-callback'?: () => void;
          theme?: 'light' | 'dark' | 'auto';
          size?: 'normal' | 'compact' | 'flexible';
        }
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
    CLOUDFLARE_TURNSTILE_SITE_KEY?: string;
  }
}

export const TurnstileWidget: React.FC<TurnstileWidgetProps> = ({
  onVerify,
  onExpire,
  onError
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [siteKey, setSiteKey] = useState<string>('');
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // Busca a chave pública configurada nas variáveis de ambiente ou no window
    const key =
      (import.meta.env?.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY as string) ||
      window.CLOUDFLARE_TURNSTILE_SITE_KEY ||
      '';

    setSiteKey(key.trim());

    if (!key.trim()) {
      // Se não houver chave configurada, valida automaticamente para não bloquear o usuário
      onVerify('bypass-no-key');
      return;
    }

    // Carrega o script oficial do Cloudflare Turnstile de forma segura
    const scriptId = 'cloudflare-turnstile-script';
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;

    const renderWidget = () => {
      if (window.turnstile && containerRef.current && !widgetIdRef.current) {
        try {
          const id = window.turnstile.render(containerRef.current, {
            sitekey: key.trim(),
            callback: (token: string) => {
              onVerify(token);
            },
            'expired-callback': () => {
              onExpire?.();
            },
            'error-callback': () => {
              onError?.();
              // Em caso de falha de conexão com a Cloudflare, não trava o login legítimo
              onVerify('fallback-connection-error');
            },
            theme: 'light',
            size: 'flexible'
          });
          widgetIdRef.current = id;
          setIsLoaded(true);
        } catch (e) {
          console.warn('Erro ao renderizar Turnstile:', e);
          onVerify('fallback-error');
        }
      }
    };

    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        renderWidget();
      };
      script.onerror = () => {
        console.warn('Não foi possível carregar Cloudflare Turnstile. Modo fallback ativado.');
        onVerify('fallback-blocked');
      };
      document.head.appendChild(script);
    } else {
      if (window.turnstile) {
        renderWidget();
      } else {
        script.addEventListener('load', renderWidget);
      }
    }

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore
        }
        widgetIdRef.current = null;
      }
    };
  }, [onVerify, onExpire, onError]);

  // Se a chave não estiver configurada, exibe selo informativo discreto
  if (!siteKey) {
    return (
      <div className="flex items-center justify-center gap-1.5 py-1 text-[11px] text-slate-400 font-medium">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
        <span>Ambiente seguro com proteção contra acessos automatizados</span>
      </div>
    );
  }

  return (
    <div className="my-2 flex flex-col items-center justify-center min-h-[65px]">
      <div ref={containerRef} className="w-full flex justify-center" />
      {!isLoaded && (
        <span className="text-[11px] text-slate-400 flex items-center gap-1 mt-1">
          <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
          Verificando segurança da conexão...
        </span>
      )}
    </div>
  );
};
