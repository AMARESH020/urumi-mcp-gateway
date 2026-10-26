WITH candidates(name, endpoint_url) AS (
    VALUES
        ('Demo MCP Server', 'http://demo-mcp:9000/mcp'),
        ('WooCommerce MCP Server', 'http://woocommerce-mcp:9100/mcp'),
        ('Inventory MCP Server', 'http://inventory-mcp:9200/mcp')
)
INSERT INTO upstream_servers (name, endpoint_url, is_enabled, timeout_ms)
SELECT c.name, c.endpoint_url, TRUE, 10000
FROM candidates AS c
WHERE NOT EXISTS (
    SELECT 1
    FROM upstream_servers AS existing
    WHERE existing.endpoint_url = c.endpoint_url
);
