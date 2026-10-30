<?php
// Keep RefreshDatabase away from deployment databases, including inherited .env values.
$set = static function (string $key, string $value): void {
    putenv($key.'='.$value);
    $_ENV[$key] = $value;
    $_SERVER[$key] = $value;
};
$mysql = (getenv('TEST_USE_MYSQL') ?: ($_ENV['TEST_USE_MYSQL'] ?? '')) === '1';
if ($mysql) {
    foreach (['DB_HOST'=>'127.0.0.1','DB_PORT'=>'33079','DB_DATABASE'=>'get_employes_test','DB_USERNAME'=>'get_employes_test'] as $key=>$expected) {
        $actual=getenv($key) ?: ($_ENV[$key] ?? '');
        if ($actual !== $expected) { throw new RuntimeException('UNSAFE_TEST_DATABASE'); }
        $set($key,$expected);
    }
    $set('DB_CONNECTION','mysql');
} else {
    $set('DB_CONNECTION','sqlite');
    $set('DB_DATABASE',':memory:');
}
$set('APP_ENV','testing');
$set('DB_URL','');
$set('APP_CONFIG_CACHE',__DIR__.'/../storage/framework/testing/unused-test-config.php');
if (is_file($_ENV['APP_CONFIG_CACHE'])) { throw new RuntimeException('UNEXPECTED_TEST_CONFIG_CACHE'); }
require __DIR__.'/../vendor/autoload.php';
