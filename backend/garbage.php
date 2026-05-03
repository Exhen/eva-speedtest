<?php
/**
 * NERV Speed Diagnostic — 下载测速数据流
 * GET ?ckSize=100 (MiB, 默认 100, 上限 1024) &r=随机数防缓存
 */
declare(strict_types=1);

header('Content-Type: application/octet-stream');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Pragma: no-cache');
header('Content-Encoding: identity');

set_time_limit(0);
ignore_user_abort(true);

$ckSize = isset($_GET['ckSize']) ? (int) $_GET['ckSize'] : 100;
if ($ckSize < 1) {
    $ckSize = 1;
}
if ($ckSize > 1024) {
    $ckSize = 1024;
}

$total = $ckSize * 1024 * 1024;
$chunk = 65536;
$sent = 0;

while ($sent < $total) {
    if (connection_aborted()) {
        break;
    }
    $n = min($chunk, $total - $sent);
    echo random_bytes($n);
    $sent += $n;
    if (function_exists('ob_flush')) {
        @ob_flush();
    }
    @flush();
}
