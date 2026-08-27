# Déploiement entreprise — POS Eau Cascade

## Deux types de postes (rien à faire à la main sur site)

| Poste | Installateur | Ce qui se passe tout seul |
|-------|--------------|---------------------------|
| **Machine mère (Server)** | `POS-Eau-Cascade-Server-*.exe` | Docker, Postgres, API `:3000`, sync-agent, **mises à jour auto** (GCS `installers/server`) |
| **Postes distants (Remote)** | `POS-Eau-Cascade-Remote-*.exe` | Connexion GCP, **mises à jour auto** (GCS `installers/remote`) |

Les deux éditions ont le bouton **Mise à jour** (écran de connexion + menu latéral) : vérification en ligne → téléchargement → redémarrage pour installer.

## Machine mère — machine vierge (magasin)

**Sur site, l’utilisateur fait seulement :**

1. Double-clic sur `POS-Eau-Cascade-Server-Setup.exe`
2. Suivre l’assistant (droits admin demandés une fois)
3. Lancer l’application

**Au premier lancement, l’app installe et configure automatiquement :**

- Docker Desktop (via winget)
- Postgres + API locale + sync-agent (images incluses dans l’installateur)
- Secrets locaux + clé sync (injectée à la compilation)
- Tâche planifiée pour redémarrer la stack à chaque ouverture de session

Aucun PowerShell, aucun `bootstrap-server.ps1`, aucun fichier à copier.

## Postes distants (caisse, bureau)

1. Installer `POS-Eau-Cascade-Remote-Setup.exe`
2. L’app se connecte au serveur GCP (ou au local si détecté)

## Côté IT / développement

Chez vous, pas chez le client — **une seule commande** :

```powershell
powershell -ExecutionPolicy Bypass -File infra/scripts/ship-all.ps1 -Bump patch -Commit
```

Cela bump la version desktop, commit/push GitHub, déploie le backend (Artifact Registry + VM), aligne la clé sync, attend la nouvelle image, builde Remote **et** Server (Postgres + API + sync-agent embarqués), puis publie les feeds GCS.

Les postes déjà installés voient la MAJ dans l’app (bouton **Mise à jour**, plus vérif au démarrage / toutes les 4 h). Rien à configurer en magasin.

Premier déploiement magasin : installer l’exe Server une fois (USB ou téléchargement GCS). Ensuite les mises à jour passent par le bouton dans l’app.

Détail agent : `.cursor/skills/ship-all/SKILL.md`.

## Vérification (IT uniquement)

```powershell
powershell -ExecutionPolicy Bypass -File infra/scripts/e2e-smoke.ps1 -ApiUrl http://35.203.5.250
```

Sur la machine mère après install : ouvrir `http://localhost:3000/auth/setup-status` dans le navigateur.

## Scripts manuels (dev / dépannage seulement)

| Script | Usage |
|--------|--------|
| `infra/scripts/ship-all.ps1` | Livraison complète (GitHub + GCP + installateurs) |
| `infra/scripts/bootstrap-server.ps1` | PC de dev, pas la machine vierge en magasin |
| `infra/scripts/dev-server-stack.ps1` | Stack Docker sans installateur |
| `infra/scripts/gcp-provision-sync.ps1` | IT : sync clé + deploy GCP (déjà appelé par ship-all) |
