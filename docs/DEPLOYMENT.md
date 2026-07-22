# Déploiement entreprise — POS Entreprises Israel

## Deux types de postes (rien à faire à la main sur site)

| Poste | Installateur | Ce qui se passe tout seul |
|-------|--------------|---------------------------|
| **Machine mère (Server)** | `POS-Freres-Basiles-Server-*.exe` | Docker, Postgres, API `:3000`, sync-agent, tâche au démarrage Windows |
| **Postes distants (Remote)** | `POS-Freres-Basiles-Remote-*.exe` | Connexion GCP, mises à jour auto |

## Machine mère — machine vierge (magasin)

**Sur site, l’utilisateur fait seulement :**

1. Double-clic sur `POS-Freres-Basiles-Server-Setup.exe`
2. Suivre l’assistant (droits admin demandés une fois)
3. Lancer l’application

**Au premier lancement, l’app installe et configure automatiquement :**

- Docker Desktop (via winget)
- Postgres + API locale + sync-agent (images incluses dans l’installateur)
- Secrets locaux + clé sync (injectée à la compilation)
- Tâche planifiée pour redémarrer la stack à chaque ouverture de session

Aucun PowerShell, aucun `bootstrap-server.ps1`, aucun fichier à copier.

## Postes distants (caisse, bureau)

1. Installer `POS-Freres-Basiles-Remote-Setup.exe`
2. L’app se connecte au serveur GCP (ou au local si détecté)

## Côté IT / développement (une seule fois)

Ces étapes se font **chez vous**, pas chez le client :

```powershell
# 1. Aligner sync GCP (depuis le PC de dev)
powershell -ExecutionPolicy Bypass -File infra/scripts/gcp-provision-sync.ps1

# 2. Builder l’installateur Server (Docker requis sur la machine de build)
cd apps/desktop
npm run icons
npm run dist:win:server

# 3. Builder + publier Remote
npm run dist:win:remote
powershell -ExecutionPolicy Bypass -File ../../infra/scripts/upload-desktop-installer.ps1 -Edition remote
```

Copier l’exe Server sur clé USB ou `installers/server/` sur GCS pour le magasin.

## Vérification (IT uniquement)

```powershell
powershell -ExecutionPolicy Bypass -File infra/scripts/e2e-smoke.ps1 -ApiUrl http://35.203.0.140
```

Sur la machine mère après install : ouvrir `http://localhost:3000/auth/setup-status` dans le navigateur.

## Scripts manuels (dev / dépannage seulement)

| Script | Usage |
|--------|--------|
| `infra/scripts/bootstrap-server.ps1` | PC de dev, pas la machine vierge en magasin |
| `infra/scripts/dev-server-stack.ps1` | Stack Docker sans installateur |
| `infra/scripts/gcp-provision-sync.ps1` | IT : sync clé + deploy GCP |
