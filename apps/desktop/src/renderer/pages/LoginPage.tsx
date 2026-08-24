import axios from 'axios';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getAuthSetupStatus, getToken } from '../services/api';
import { AppUpdateControls } from '../components/AppUpdateControls';
import { BrandLogo } from '../components/BrandLogo';
import { PasswordField } from '../components/PasswordField';
import { BRAND_NAME } from '../config/brand';

function setupStatusErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const code = err.code;
    const status = err.response?.status;
    if (status != null && status >= 500) {
      return 'L’API répond mais renvoie une erreur serveur (souvent base Postgres arrêtée ou migrations Prisma). Vérifiez Docker/DB et les logs du backend.';
    }
    if (status != null && status >= 400) {
      return `L’API a répondu avec une erreur (${status}). Vérifiez l’URL dans la config.`;
    }
    if (code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      return 'Délai dépassé : le serveur ne répond pas (pare-feu EC2, mauvaise IP, ou API arrêtée). Testez l’URL dans le navigateur (voir README desktop).';
    }
    if (!err.response) {
      return 'Impossible de joindre le serveur (réseau, API arrêtée, ou port fermé). En dev : lancez le backend sur le port attendu ; pour l’EC2 : ouvrez le groupe de sécurité (TCP 3000).';
    }
  }
  return 'Impossible de joindre le serveur. Vérifiez que l’API tourne.';
}

export function LoginPage() {
  const { login, registerFirstAdmin, user, loading } = useAuth();
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [setupLoading, setSetupLoading] = useState(true);
  const [needsFirstUser, setNeedsFirstUser] = useState(false);
  const [setupFetchError, setSetupFetchError] = useState('');

  const [bPhone, setBPhone] = useState('');
  const [bPassword, setBPassword] = useState('');
  const [bPassword2, setBPassword2] = useState('');
  const [bFullName, setBFullName] = useState('');
  const [bEmail, setBEmail] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getAuthSetupStatus();
        if (!cancelled) setNeedsFirstUser(s.needsFirstUser);
      } catch (err) {
        if (!cancelled) {
          setSetupFetchError(setupStatusErrorMessage(err));
          setNeedsFirstUser(false);
        }
      } finally {
        if (!cancelled) setSetupLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loading && (user || getToken())) {
    return <Navigate to="/app" replace />;
  }

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await login(phone, password);
      navigate('/app', { replace: true });
    } catch {
      setError('Identifiants invalides ou compte désactivé.');
    }
  }

  async function onBootstrap(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (bPassword !== bPassword2) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }
    try {
      await registerFirstAdmin({
        phone: bPhone,
        password: bPassword,
        fullName: bFullName.trim() || undefined,
        email: bEmail.trim() || undefined,
      });
      navigate('/app', { replace: true });
    } catch {
      setError('Création impossible (serveur ou numéro déjà utilisé).');
    }
  }

  if (setupLoading) {
    return (
      <main className="login-page">
        <div className="auth-card card">
          <p className="login-sub">Chargement…</p>
          <div className="login-update-row">
            <AppUpdateControls variant="login" />
          </div>
        </div>
      </main>
    );
  }

  if (needsFirstUser) {
    return (
      <main className="login-page">
        <div className="auth-card card">
          <div className="login-brand">
            <BrandLogo size={56} wide />
          </div>
          <h1 className="login-title">{BRAND_NAME}</h1>
          <p className="login-sub">Configuration initiale — créez le compte administrateur.</p>
          <form className="form-grid" onSubmit={(e) => void onBootstrap(e)}>
            <label>
              Numéro de téléphone
              <input
                type="tel"
                inputMode="tel"
                autoComplete="username"
                value={bPhone}
                onChange={(e) => setBPhone(e.target.value)}
                placeholder="+225…"
                required
              />
            </label>
            <label>
              Nom complet (optionnel)
              <input
                type="text"
                autoComplete="name"
                value={bFullName}
                onChange={(e) => setBFullName(e.target.value)}
              />
            </label>
            <label>
              E-mail (optionnel)
              <input
                type="email"
                autoComplete="email"
                value={bEmail}
                onChange={(e) => setBEmail(e.target.value)}
              />
            </label>
            <PasswordField
              label="Mot de passe"
              value={bPassword}
              onChange={setBPassword}
              autoComplete="new-password"
              required
            />
            <PasswordField
              label="Confirmer le mot de passe"
              value={bPassword2}
              onChange={setBPassword2}
              autoComplete="new-password"
              required
            />
            {error ? <p className="error-text">{error}</p> : null}
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Création…' : 'Créer l’administrateur'}
            </button>
          </form>
          <div className="login-update-row">
            <AppUpdateControls variant="login" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="login-page">
      <div className="auth-card card">
        <div className="login-brand">
          <BrandLogo size={56} wide />
        </div>
        <h1 className="login-title">{BRAND_NAME}</h1>
        <p className="login-sub">Connexion au point de vente</p>
        {setupFetchError ? <p className="error-text">{setupFetchError}</p> : null}
        <form className="form-grid" onSubmit={(e) => void onLogin(e)}>
          <label>
            Numéro de téléphone
            <input
              type="tel"
              inputMode="tel"
              autoComplete="username"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+225…"
              required
            />
          </label>
          <PasswordField
            label="Mot de passe"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            required
          />
          {error ? <p className="error-text">{error}</p> : null}
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
        <div className="login-update-row">
          <AppUpdateControls variant="login" />
        </div>
      </div>
    </main>
  );
}
