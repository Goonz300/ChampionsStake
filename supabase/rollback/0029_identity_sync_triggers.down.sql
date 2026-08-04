-- Rollback 0029: Identity Synchronization Triggers
drop trigger if exists trg_auth_users_handle_email_verified on auth.users;
drop function if exists fn_handle_user_email_verified();
drop trigger if exists trg_auth_users_handle_new_user on auth.users;
drop function if exists fn_handle_new_user();
