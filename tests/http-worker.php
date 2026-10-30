<?php

use Illuminate\Contracts\Http\Kernel;
use Illuminate\Http\Request;

// Separate PHP process, shared dedicated test DB, real Laravel HTTP kernel.
require __DIR__.'/../backend/vendor/autoload.php';
$app = require __DIR__.'/../backend/bootstrap/app.php';
$data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
$r = Request::create($data['path'], $data['method'], [], [], [], ['HTTP_ACCEPT' => 'application/json', 'CONTENT_TYPE' => 'application/json', 'HTTP_AUTHORIZATION' => 'Bearer '.getenv('TEST_INGEST_TOKEN'), 'HTTP_X_AGENT_ORIGIN' => 'fixture-agent', 'REMOTE_ADDR' => '127.0.0.1'], json_encode($data['body'] ?? new stdClass, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
$kernel = $app->make(Kernel::class);
$response = $kernel->handle($r);
echo json_encode(['status' => $response->getStatusCode(), 'body' => json_decode($response->getContent(), true)]);
$kernel->terminate($r, $response);
