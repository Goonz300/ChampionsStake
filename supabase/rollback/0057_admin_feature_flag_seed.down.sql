-- Rollback 0057: Additional Feature Flag Seed Data
delete from feature_flags where key in (
  'real_money_enabled', 'chat_enabled', 'maintenance_mode', 'experimental_features_enabled'
);
