<?php
/**
 * NERV Speed Diagnostic — Ping（GET）与上传 sink（POST/PUT）
 * 注意：不得对 php://input 使用 feof() 主循环，否则在部分环境下会死读导致上传挂死。
 */
declare(strict_types=1);

header('Cache-Control: no-store, no-cache, must-revalidate');
header('Pragma: no-cache');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET' || $method === 'HEAD') {
    header('Content-Type: text/plain; charset=utf-8');
    if ($method === 'HEAD') {
        exit;
    }
    echo '';
    exit;
}

if ($method === 'POST' || $method === 'PUT' || $method === 'PATCH') {
    header('Content-Type: text/plain; charset=utf-8');

    $in = fopen('php://input', 'rb');
    if ($in) {
        $total = isset($_SERVER['CONTENT_LENGTH']) ? (int) $_SERVER['CONTENT_LENGTH'] : -1;
        $read = 0;
        $block = 1048576;

        while (!connection_aborted()) {
            if ($total >= 0 && $read >= $total) {
                break;
            }
            $want = $total >= 0 ? min($block, $total - $read) : $block;
            if ($want < 1) {
                break;
            }
            $chunk = fread($in, $want);
            if ($chunk === false || $chunk === '') {
                break;
            }
            $read += strlen($chunk);
        }
        fclose($in);
    }

    http_response_code(200);
    exit;
}

http_response_code(405);
header('Allow: GET, HEAD, POST, PUT, PATCH');
header('Content-Type: text/plain; charset=utf-8');
echo 'METHOD NOT ALLOWED';
