-- Rollback 0082: Escrow Accounts Atomic Adjust Function
drop function if exists fn_adjust_escrow_locked(uuid, bigint);
