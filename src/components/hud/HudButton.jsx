import { C } from '../../lib/constants.js';

// Botão padrão do HUD. `active` = preenchido (estado ligado); `size` sm|md|lg.
// Mantém os mesmos valores dos botões inline espalhados hoje pelo app —
// a adoção ampla acontece na Fase 4; aqui ele já existe como primitiva.
const SIZES = {
  sm: { padding: '3px 8px', fontSize: 9, letterSpacing: '0.18em' },
  md: { padding: '6px 14px', fontSize: 10, letterSpacing: '0.22em' },
  lg: { padding: '8px 18px', fontSize: 10, letterSpacing: '0.22em' },
};

export function HudButton({
  children,
  active = false,
  disabled = false,
  size = 'md',
  color = C.accent,
  style,
  ...rest
}) {
  const s = SIZES[size] || SIZES.md;
  return (
    <button
      disabled={disabled}
      style={{
        background: active ? color : 'transparent',
        color: active ? C.bg : disabled ? C.dim : color,
        border: `1px solid ${disabled ? C.dim : active ? color : C.accentDim}`,
        fontFamily: 'inherit',
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...s,
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
