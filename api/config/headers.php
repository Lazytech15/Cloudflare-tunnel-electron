<?php
// config/headers.php - Reusable headers configuration

/**
 * Set common headers for all API endpoints
 */
function setApiHeaders() {
    // Set JSON content type
    header('Content-Type: application/json');
    
    // CORS headers - adjust origins as needed
    $allowedOrigins = [
        'http://localhost:5173',
        'http://localhost:3000',
        'http://127.0.0.1:5173',
        'https://qxw.2ee.mytemp.website' // Add your production domain
    ];
    
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    
    if (in_array($origin, $allowedOrigins)) {
        header("Access-Control-Allow-Origin: $origin");
    } else {
        header('Access-Control-Allow-Origin: *'); // Or restrict this in production
    }
    
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Max-Age: 86400'); // Cache preflight for 24 hours
    
    // Security headers
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('X-XSS-Protection: 1; mode=block');
    
    // Handle preflight OPTIONS request
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(200);
        exit();
    }
}

/**
 * Send JSON response
 * @param array $data Response data
 * @param int $statusCode HTTP status code
 */
function sendJsonResponse($data, $statusCode = 200) {
    http_response_code($statusCode);
    echo json_encode($data, JSON_PRETTY_PRINT);
    exit();
}

/**
 * Send error response
 * @param string $message Error message
 * @param int $statusCode HTTP status code
 * @param array $details Additional error details
 */
function sendErrorResponse($message, $statusCode = 500, $details = []) {
    $response = [
        'success' => false,
        'error' => $message
    ];
    
    if (!empty($details)) {
        $response['details'] = $details;
    }
    
    sendJsonResponse($response, $statusCode);
}

/**
 * Send success response
 * @param mixed $data Response data
 * @param string $message Optional success message
 */
function sendSuccessResponse($data, $message = null) {
    $response = [
        'success' => true
    ];
    
    if ($message !== null) {
        $response['message'] = $message;
    }
    
    if (is_array($data)) {
        $response = array_merge($response, $data);
    } else {
        $response['data'] = $data;
    }
    
    sendJsonResponse($response, 200);
}

/**
 * Log request for debugging
 */
function logRequest() {
    $logMessage = sprintf(
        "%s - %s %s\n",
        date('Y-m-d H:i:s'),
        $_SERVER['REQUEST_METHOD'],
        $_SERVER['REQUEST_URI']
    );
    
    // In production, write to a log file
    error_log($logMessage);
}
?>