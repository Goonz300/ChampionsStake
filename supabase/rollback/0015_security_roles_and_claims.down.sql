-- Rollback 0015: Roles & JWT Claims
revoke execute on function custom_access_token_hook(jsonb) from supabase_auth_admin;
drop function if exists custom_access_token_hook(jsonb);

-- NOTE: PostgreSQL does not support removing a value from an enum type
-- (there is no `ALTER TYPE ... DROP VALUE`). The 'support' value added to
-- user_role in 0015 cannot be cleanly rolled back without recreating the
-- entire enum and every column/policy/function that references it. If this
-- must be undone, the safe path is: (1) reassign any profiles.role='support'
-- rows to another role, (2) recreate user_role without 'support' under a
-- temporary name, (3) migrate all dependent columns over, (4) drop the old
-- type. That is a deliberate, reviewed migration in its own right — not
-- something to script blindly into a rollback file.
