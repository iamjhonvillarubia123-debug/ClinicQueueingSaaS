-- Match the existing email policy: a permanently closed identity retains its
-- history but does not reserve a sign-in identifier for a future new account.
-- Create the replacement before dropping the global index; the transaction
-- keeps uniqueness enforced throughout the change. No account rows are changed.
BEGIN;

CREATE UNIQUE INDEX "User_mobileNumberHash_current_nonterminal_key"
ON "User"("mobileNumberHash")
WHERE "accountStatus" <> 'PERMANENTLY_CLOSED';

DROP INDEX "User_mobileNumberHash_key";

COMMIT;
