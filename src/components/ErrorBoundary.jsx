import { Component } from 'react';
import { C } from '../lib/constants.js';

// Blinda o chunk lazy do VaultBrain (three.js ~540kB): se o carregamento do
// chunk falhar (rede) ou a cena estourar em render, mostra um fallback do HUD
// com REINICIAR em vez de derrubar a árvore inteira num tela em branco.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('J.A.R.V.I.S. · falha na UI:', error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return (
        <div style={{ flex: 1, minHeight: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'inline-block', padding: '22px 34px', border: `1px solid ${C.lineStrong}`, background: 'rgba(5,10,20,0.78)', backdropFilter: 'blur(6px)', textAlign: 'center' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.32em', color: C.warn, marginBottom: 14 }}>NÚCLEO GRÁFICO INTERROMPIDO</div>
            <button onClick={this.reset} style={{ background: 'transparent', border: `1px solid ${C.accentDim}`, color: C.accent, padding: '8px 18px', fontFamily: 'inherit', fontSize: 10, letterSpacing: '0.22em', cursor: 'pointer' }}>▸ REINICIAR</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
