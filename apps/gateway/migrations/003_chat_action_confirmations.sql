BEGIN;

CREATE TABLE IF NOT EXISTS chat_action_confirmations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL CHECK (
        tool_name LIKE '%__create_product'
        OR tool_name LIKE '%__update_order_status'
    ),
    action_arguments JSONB NOT NULL
        CHECK (jsonb_typeof(action_arguments) = 'object'),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN (
            'pending',
            'executing',
            'succeeded',
            'failed',
            'cancelled',
            'expired'
        )
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes'),
    decided_at TIMESTAMPTZ,
    execution_started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    request_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_chat_action_confirmations_user_created
    ON chat_action_confirmations(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_action_confirmations_pending_expiry
    ON chat_action_confirmations(expires_at)
    WHERE status = 'pending';

COMMIT;
