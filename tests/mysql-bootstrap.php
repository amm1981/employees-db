<?php

// Only used with the dedicated instance created by Start-TestMySql.ps1.
$port = (int) (getenv('TEST_MYSQL_PORT') ?: 33079);
if ($port !== 33079) {
    throw new RuntimeException('DEDICATED_PORT_REQUIRED');
}
$db = new PDO("mysql:host=127.0.0.1;port=$port", 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$db->exec('CREATE DATABASE IF NOT EXISTS get_employes_test CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
$pass = getenv('TEST_DB_PASSWORD');
if (! $pass || strlen($pass) < 40) {
    throw new RuntimeException('TEST_DB_PASSWORD_REQUIRED');
}
$literal = $db->quote($pass);
$db->exec("CREATE USER IF NOT EXISTS 'get_employes_test'@'127.0.0.1' IDENTIFIED BY $literal");
$db->exec("ALTER USER 'get_employes_test'@'127.0.0.1' IDENTIFIED BY $literal");
$db->exec("GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES ON get_employes_test.* TO 'get_employes_test'@'127.0.0.1'");
echo 'Isolated MySQL '.$db->query('SELECT VERSION()')->fetchColumn()." fixture database ready\n";
