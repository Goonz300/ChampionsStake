-- Rollback 0043: Challenge Pins Table
drop policy if exists challenge_pins_delete_own on challenge_pins;
drop policy if exists challenge_pins_insert_own on challenge_pins;
drop policy if exists challenge_pins_select_own on challenge_pins;
drop table if exists challenge_pins;
