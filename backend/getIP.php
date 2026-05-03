<?php
/**
 * NERV Speed Diagnostic — 仅返回服务端所见客户端 IP（不做归属地/ISP 查询）
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

function nerv_client_ip(): string
{
    if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
        return trim($_SERVER['HTTP_CF_CONNECTING_IP']);
    }
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $parts = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
        $first = trim($parts[0]);
        if ($first !== '') {
            return $first;
        }
    }
    if (!empty($_SERVER['HTTP_X_REAL_IP'])) {
        return trim($_SERVER['HTTP_X_REAL_IP']);
    }
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}

$ip = nerv_client_ip();

$raw = [
    'ip'      => $ip,
    'country' => '',
    'region'  => '',
    'city'    => '',
    'isp'     => '',
    'asn'     => '',
];

echo json_encode([
    'processedString' => $ip,
    'rawIspInfo'      => $raw,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
