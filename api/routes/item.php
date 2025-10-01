<?php
// index.php - Main router file for items API
require_once __DIR__ . '/validators.php';
require_once __DIR__ . '/ItemService.php';

header('Content-Type: application/json');

// Get request method and path
$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// Remove base path if needed (adjust according to your setup)
$basePath = '/api/items';
$route = str_replace($basePath, '', $path);

// Route dispatcher
try {
    // Stock routes
    if (preg_match('#^/stock/(\d+)$#', $route, $matches)) {
        require_once __DIR__ . '/itemComponents/stock.php';
        handleStockUpdate($matches[1]);
    } 
    elseif (preg_match('#^/stock/(\d+)/insert$#', $route, $matches)) {
        require_once __DIR__ . '/itemComponents/stock.php';
        handleStockInsert($matches[1]);
    }
    elseif (preg_match('#^/stock/(\d+)/quantity$#', $route, $matches)) {
        require_once __DIR__ . '/itemComponents/stock.php';
        handleStockQuantity($matches[1]);
    }
    elseif (preg_match('#^/stock/(\d+)/out$#', $route, $matches)) {
        require_once __DIR__ . '/itemComponents/stock.php';
        handleStockOut($matches[1]);
    }
    // Bulk routes
    elseif ($route === '/bulk' && $method === 'POST') {
        require_once __DIR__ . '/itemComponents/bulk.php';
        handleBulkCreate();
    }
    // Report routes
    elseif ($route === '/reports/dashboard/stats') {
        require_once __DIR__ . '/itemComponents/reports.php';
        handleDashboardStats();
    }
    elseif ($route === '/reports/inventory-summary') {
        require_once __DIR__ . '/itemComponents/reports.php';
        handleInventorySummary();
    }
    // Export routes
    elseif ($route === '/export/csv') {
        require_once __DIR__ . '/export.php';
        handleExportCSV();
    }
    elseif (preg_match('#^/export/supplier-report/(.+)$#', $route, $matches)) {
        require_once __DIR__ . '/itemComponents/export.php';
        handleSupplierReport(urldecode($matches[1]));
    }
    // Checkout routes
    elseif ($route === '/checkout' && $method === 'POST') {
        require_once __DIR__ . '/itemComponents/checkout.php';
        handleCheckout();
    }
    // Filter options
    elseif ($route === '/filters/options') {
        require_once __DIR__ . '/itemComponents/items.php';
        handleFilterOptions();
    }
    // Supplier items
    elseif (preg_match('#^/supplier/(.+)$#', $route, $matches)) {
        require_once __DIR__ . '/itemComponents/items.php';
        handleItemsBySupplier(urldecode($matches[1]));
    }
    // Basic CRUD routes
    elseif ($route === '' || $route === '/') {
        require_once __DIR__ . '/itemComponents/items.php';
        if ($method === 'GET') {
            handleGetItems();
        } elseif ($method === 'POST') {
            handleCreateItem();
        }
    }
    elseif (preg_match('#^/(\d+)$#', $route, $matches)) {
        require_once __DIR__ . '/itemComponents/items.php';
        $itemId = $matches[1];
        
        if ($method === 'GET') {
            handleGetItem($itemId);
        } elseif ($method === 'PUT') {
            handleUpdateItem($itemId);
        } elseif ($method === 'DELETE') {
            handleDeleteItem($itemId);
        }
    }
    else {
        http_response_code(404);
        echo json_encode([
            'success' => false,
            'error' => 'Route not found'
        ]);
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => 'Server error',
        'message' => $e->getMessage()
    ]);
}