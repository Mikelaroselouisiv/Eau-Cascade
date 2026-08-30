# Agents — POS Eau Cascade

## Isolation (critique)

Ce projet est un **fork opérationnel** pour **Eau Cascade**.  
Israel et Frères Baziles doivent continuer à tourner **sans aucune intervention** depuis ce dépôt.

- GCP autorisé : **`eau-cascade`** uniquement
- Compte SDK : config **`pos-eau-cascade`** (`larosemikelson@gmail.com`)
- **Ne jamais** cibler `pos-freres-basiles`, `pos-entrprise-israel`, leurs buckets, VMs, Artifact Registry, secrets GitHub, ou clés PEM

Voir aussi : `.cursor/rules/tenant-isolation-eau-cascade.mdc`  
Garde runtime : `infra/scripts/assert-eau-cascade-gcp.ps1`

## Fuseau horaire (critique)

Toute date métier / affichage / borne de journée = **`America/Port-au-Prince`** uniquement.  
Ne pas utiliser le fuseau OS de la machine ni UTC pour l’UI ou les filtres « jour / mois ».

Voir `apps/backend/src/common/time/timezone.ts` et `apps/desktop/src/renderer/utils/datetime.ts`.

## Agent post-modification (release)

Quand l’utilisateur a **fini de modifier le code**, une seule commande :

```powershell
powershell -ExecutionPolicy Bypass -File infra/scripts/ship-all.ps1 -Bump patch -Commit
```

Cela enchaîne : bump desktop, commit + push `main`, backend Artifact Registry → VM GCP, attente CI, puis installateurs Remote + Server (stack embarquée) vers GCS pour les MAJ in-app.

Skill : `.cursor/skills/ship-all/SKILL.md`  
Détail : `.cursor/rules/post-mod-release-agent.mdc`  
Docs : `docs/DEPLOYMENT.md`, `docs/GCP_EAU_CASCADE.md`

## UI — pas de tutoriel

Ne pas ajouter de phrases d’aide / consigne sous les champs (« Cochez tous les… », « Choisissez X pour afficher Y »). Libellés + contrôles seulement. Détail : `.cursor/rules/no-tutorial-ui-copy.mdc`

## Synchronisation (critique)

Toute nouvelle table métier (livraison, drop, session production, transfert interne, flux usine, etc.) doit entrer dans le cycle sync : `uuid`, `updatedAt`, `SYNC_ENTITIES`, `apps/sync-agent/src/entities.js`, `ENTITY_FK_MAP`, `delegate()`. Les livraisons classiques (`Delivery` / `DeliveryItem` / `DeliveryDrop`) en font partie. Détail : `.cursor/rules/sync-entities.mdc`
