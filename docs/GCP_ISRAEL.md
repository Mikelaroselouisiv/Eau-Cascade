# GCP — POS Entreprises Israel

**Isolation :** ce document et ce dépôt concernent **uniquement** `pos-entrprise-israel`.  
Ne jamais opérer sur `pos-freres-basiles`.

## Ressources créées

| Ressource | Valeur |
|-----------|--------|
| Project | `pos-entrprise-israel` |
| Compte SDK | config `pos-israel` / `israelnesly0@gmail.com` |
| Région / zone | `northamerica-northeast1` / `northamerica-northeast1-a` |
| Artifact Registry | `pos-backend` |
| Image backend | `northamerica-northeast1-docker.pkg.dev/pos-entrprise-israel/pos-backend/backend` |
| Bucket GCS | `gs://pos-entrprise-israel-assets` |
| VM | `pos-api` → IP publique `35.203.0.140` |
| SA CI | `github-actions@pos-entrprise-israel.iam.gserviceaccount.com` |
| SA VM | `pos-vm@pos-entrprise-israel.iam.gserviceaccount.com` |
| WIF | `projects/845337518093/locations/global/workloadIdentityPools/github-pool/providers/github-provider` |

## Garde-fous

```powershell
gcloud config configurations activate pos-israel
powershell -ExecutionPolicy Bypass -File infra/scripts/assert-israel-gcp.ps1
powershell -ExecutionPolicy Bypass -File infra/scripts/gcp-bootstrap-israel.ps1
```

## GitHub secrets / vars (repo Israel)

Secrets : `GCP_PROJECT_ID`, `GCP_SERVICE_ACCOUNT`, `GCP_WORKLOAD_IDENTITY_PROVIDER`  
Vars : `GCP_REGION`, `GCP_ARTIFACT_REPO`, `GCP_VM_NAME`, `GCP_VM_ZONE`  

Valeurs exactes : voir `secrets/README.md` (local, gitignoré) ou tableau ci-dessus.

## Suite après premier push backend

Le CI build/push l’image puis déploie sur la VM.  
Sans image dans Artifact Registry, `docker compose up` sur la VM échouera au pull — lancer le workflow **Backend - build and push to GCP**.
