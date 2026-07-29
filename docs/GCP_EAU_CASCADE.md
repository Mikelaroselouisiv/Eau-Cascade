# GCP — POS Eau Cascade

**Isolation :** ce document et ce dépôt concernent **uniquement** `eau-cascade`.  
Ne jamais opérer sur `pos-freres-basiles` ni `pos-entrprise-israel`.

## Ressources

| Ressource | Valeur |
|-----------|--------|
| Project | `eau-cascade` |
| Compte SDK | config `pos-eau-cascade` / `larosemikelson@gmail.com` |
| Région / zone | `northamerica-northeast1` / `northamerica-northeast1-a` |
| Artifact Registry | `pos-backend` |
| Image backend | `northamerica-northeast1-docker.pkg.dev/eau-cascade/pos-backend/backend` |
| Bucket GCS | `gs://eau-cascade-assets` |
| VM | `pos-api` (IP après bootstrap) |
| SA CI | `github-actions@eau-cascade.iam.gserviceaccount.com` |
| SA VM | `pos-vm@eau-cascade.iam.gserviceaccount.com` |

## Garde-fous

```powershell
gcloud config configurations activate pos-eau-cascade
powershell -ExecutionPolicy Bypass -File infra/scripts/assert-eau-cascade-gcp.ps1
powershell -ExecutionPolicy Bypass -File infra/scripts/gcp-bootstrap-eau-cascade.ps1
```

## GitHub secrets / vars (repo Eau-Cascade)

Secrets : `GCP_PROJECT_ID`, `GCP_SERVICE_ACCOUNT`, `GCP_WORKLOAD_IDENTITY_PROVIDER`  
Vars : `GCP_REGION`, `GCP_ARTIFACT_REPO`, `GCP_VM_NAME`, `GCP_VM_ZONE`

## Suite après premier push backend

Le CI build/push l’image puis déploie sur la VM.  
Sans image dans Artifact Registry, `docker compose up` sur la VM échouera au pull — lancer le workflow **Backend - build and push to GCP**.
