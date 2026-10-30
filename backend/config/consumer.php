<?php

return [
    'token_ttl_minutes' => (int) env('CONSUMER_TOKEN_TTL_MINUTES', 60),
    // SQL datetime/datetime2 contain no timezone; configure the source's zone.
    'source_timezone' => env('SQL_SOURCE_TIMEZONE', 'America/Lima'),
];
