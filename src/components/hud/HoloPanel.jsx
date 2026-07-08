import { Corners } from './Corners.jsx';

// Superfície flutuante "holográfica" — glass + cantoneiras. `drift` liga a
// flutuação suave (jv-drift); `corners={false}` desliga as cantoneiras.
// Estilos extras via `style`; classes extras via `className`.
export function HoloPanel({
  children,
  drift = false,
  corners = true,
  className = '',
  style,
  ...rest
}) {
  const cls = ['jv-holo-glass', drift ? 'jv-drift' : '', className].filter(Boolean).join(' ');
  return (
    <div className={cls} style={{ position: 'relative', padding: '16px 18px', ...style }} {...rest}>
      {corners && <Corners />}
      {children}
    </div>
  );
}
