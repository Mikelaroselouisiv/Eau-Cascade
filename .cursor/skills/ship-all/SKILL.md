---
name: ship-all
description: >-
  Ships POS Eau Cascade to production: bump desktop semver, commit/push GitHub,
  backend Artifact Registry + VM GCP, embed Postgres/API/sync in the Server
  installer, upload Remote+Server to GCS so installed apps update in-app.
  Use when the user finished changes and asks to ship, ship-all, publier,
  release, déployer, mettre en production, push GitHub/GCP, or mettre à jour partout.
---

# Ship-all — POS Eau Cascade

Ne lance ce workflow **que sur demande explicite** (ship, publie, mets en production, push GitHub + GCP).

Commande unique — ne pas recoller les étapes à la main :

```powershell
powershell -ExecutionPolicy Bypass -File infra/scripts/ship-all.ps1 -Bump patch -Commit
```

Le script répare le PATH Windows (scoop `git` / `gcloud` / `gh`) puis enchaîne tout.

Après chaque build, copie aussi les exe à la **racine du repo** (cette machine, USB) : `POS-Eau-Cascade-Remote-Setup.exe` / `POS-Eau-Cascade-Server-Setup.exe` + noms versionnés. Gitignorés, jamais GitHub.

## Checklist

```
Ship-all Eau Cascade:
- [ ] 1. Isolation GCP (pos-eau-cascade / projet eau-cascade)
- [ ] 2. ship-all.ps1 -Bump patch -Commit (attend CI backend AR avant Server)
- [ ] 3. Rapport (SHA, version, URLs feeds, run backend)
```

## Modèle mental (critique)

| Cible | Mis à jour par |
|-------|----------------|
| Apps **Remote** (API cloud) | CI backend → VM GCP `35.203.5.250` **et** exe Remote sur GCS |
| Apps **Server** (machine mère magasin) | Installateur NSIS qui embarque `server-stack/images/*.tar` (backend + Postgres + sync-agent) → GCS → bouton Mise à jour dans l’app |
| Docker sur le **poste de dev** | Ignoré pour la prod magasin |

Ne jamais considérer que déployer la VM GCP ou toucher Docker en local met à jour un Server magasin.

Le runner GitHub **n’a pas Docker** : le Server se builde **en local**. `-UseCI` = Remote via Actions, Server toujours local.

## Flags

| Besoin | Flags |
|--------|--------|
| Fix / UI + stacks | `-Bump patch -Commit` |
| Feature | `-Bump minor -Commit` |
| Backend cloud seul (Remote API ; magasins inchangés) | `-Bump none -Desktop none -Commit -Message "…"` |
| Backend + magasins | `-Bump patch -Commit` |
| Remote via CI, Server local | `-Bump patch -Commit -UseCI` |
| Simulation | `-DryRun` |
| Skip attente CI (déconseillé) | `-SkipWaitBackend` |

## Isolation

- `gcloud config configurations activate pos-eau-cascade`
- `infra/scripts/assert-eau-cascade-gcp.ps1` — refuser si le projet n’est pas `eau-cascade`
- Jamais Israel / Frères Baziles

Remote Git : `origin` → `https://github.com/Mikelaroselouisiv/Eau-Cascade.git`

## Anti-patterns

- Committer `secrets/`, `*.pem`, `.env`, `release/*.exe`, `ChatGPT Image*`
- Builder sans bump si on publie un nouvel installateur (les clients ne voient pas la MAJ)
- Builder Server **avant** que `backend:latest` soit sur Artifact Registry
- Confondre Docker local / VM GCP / stack embarqué Server magasin
- Déclencher le workflow Desktop `edition=server` sur GitHub (pas de Docker sur le runner)
