-- Israel n’écrit plus ticketNo (remplacé par txnNumber).
-- La colonne héritée Cascade restait NOT NULL et bloquait Sale.create.
ALTER TABLE "Sale" ALTER COLUMN "ticketNo" DROP NOT NULL;
