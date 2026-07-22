# Agents — POS Entreprises Israel

## Isolation (critique)

Ce projet est un **fork opérationnel** pour **Entreprises Israel**.  
Frères Baziles doit continuer à tourner **sans aucune intervention** depuis ce dépôt.

- GCP autorisé : **`pos-entrprise-israel`** uniquement
- Compte SDK : config **`pos-israel`** (`israelnesly0@gmail.com`)
- **Ne jamais** cibler `pos-freres-basiles`, ses buckets, VMs, Artifact Registry, secrets GitHub, ou clés PEM

Voir aussi : `.cursor/rules/tenant-isolation-israel.mdc`  
Garde runtime : `infra/scripts/assert-israel-gcp.ps1`

## Provisionnement

```powershell
gcloud config configurations activate pos-israel
powershell -ExecutionPolicy Bypass -File infra/scripts/gcp-bootstrap-israel.ps1
```
