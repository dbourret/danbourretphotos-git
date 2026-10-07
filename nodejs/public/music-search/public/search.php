<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
function respond(int $code, array $body): never {
    http_response_code($code);
    echo json_encode($body, JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'GET') respond(405, ['error' => 'Use GET to search.']);
$fields = ['song','artist','album','directory','filename','parent_folder','full_path','track_number','file_type','parse_method','parse_confidence','import_id'];
$field = $_GET['field'] ?? 'song';
$q = $_GET['q'] ?? '';
$pageRaw = $_GET['page'] ?? '1';
if (!is_string($field) || !in_array($field, $fields, true)) respond(400, ['error'=>'Choose a valid search column.']);
if (!is_string($q) || strlen($q) > 400) respond(400, ['error'=>'Enter a search of no more than 400 bytes.']);
$q = trim($q);
if ($q === '') respond(400, ['error'=>'Enter text to search for.']);
$page = filter_var($pageRaw, FILTER_VALIDATE_INT, ['options'=>['min_range'=>1,'max_range'=>100000]]);
if ($page === false) respond(400, ['error'=>'Invalid page number.']);
$size = 50;
try {
    // For public_html/music/search.php this defaults to <account>/music-search-private/config.php.
    $configPath = getenv('MUSIC_CONFIG_PATH') ?: dirname(__DIR__, 2) . '/music-search-private/config.php';
    if (!is_file($configPath)) throw new RuntimeException('Private configuration is missing.');
    $c = require $configPath;
    $driver = $c['driver'];
    if (!in_array($driver, ['mysql','sqlsrv'], true)) throw new RuntimeException('Unsupported driver.');
    if ($driver === 'mysql') {
        $dsn = "mysql:host={$c['host']};port={$c['port']};dbname={$c['database']};charset=utf8mb4";
        $table = '`MusicLibrary`';
        $column = '`' . $field . '`';
        $expression = "CAST($column AS CHAR)";
    } else {
        $dsn = "sqlsrv:Server={$c['host']},{$c['port']};Database={$c['database']};Encrypt=1;TrustServerCertificate=0";
        $table = '[dbo].[MusicLibrary]';
        $column = '[' . $field . ']';
        $expression = "CAST($column AS NVARCHAR(2000))";
    }
    $pdo = new PDO($dsn, $c['username'], $c['password'], [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    if ($driver === 'mysql') $pdo->setAttribute(PDO::ATTR_EMULATE_PREPARES, false);
    // Escape user wildcard characters so the query finds the literal entered text anywhere.
    $escaped = str_replace(['!','%','_'], ['!!','!%','!_'], $q);
    if ($driver === 'sqlsrv') $escaped = str_replace('[', '![', $escaped);
    $pattern = '%' . $escaped . '%';
    $where = "$expression LIKE :pattern ESCAPE '!'";
    $count = $pdo->prepare("SELECT COUNT(*) FROM $table WHERE $where");
    $count->execute(['pattern'=>$pattern]);
    $total = (int)$count->fetchColumn();
    $pages = max(1, (int)ceil($total / $size));
    $page = min($page, $pages);
    $offset = ($page - 1) * $size;
    // Pagination numbers are server-validated integers; field names come only from the allowlist.
    $limit = $driver === 'mysql' ? "LIMIT $size OFFSET $offset" : "OFFSET $offset ROWS FETCH NEXT $size ROWS ONLY";
    $stmt = $pdo->prepare("SELECT * FROM $table WHERE $where ORDER BY song, artist, import_id $limit");
    $stmt->execute(['pattern'=>$pattern]);
    respond(200, ['rows'=>$stmt->fetchAll(), 'total'=>$total,'page'=>$page,'pages'=>$pages,'page_size'=>$size]);
} catch (Throwable $e) {
    error_log('Music search: ' . $e->getMessage());
    respond(503, ['error'=>'The music database is unavailable. Please check the server configuration or try again later.']);
}
