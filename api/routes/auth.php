<?php
// routes/auth.php - Authentication routes
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../config/headers.php';

/**
 * Get user role and permissions
 */
function getUserRoleAndPermissions($user, $department) {
    $role = 'user';
    $permissions = [];
    
    if ($department === 'super-admin' || $user['access_level'] === 'super-admin') {
        $role = 'super-admin';
        $permissions = ['*'];
    } elseif ($user['access_level'] === 'admin') {
        $role = 'admin';
        $permissions = [
            'view_employees',
            'edit_employees',
            'view_attendance',
            'manage_department',
            'view_reports'
        ];
    } elseif ($user['access_level'] === 'manager') {
        $role = 'manager';
        $permissions = [
            'view_employees',
            'view_attendance',
            'view_reports'
        ];
    } else {
        $role = 'user';
        $permissions = [
            'view_own_profile',
            'view_own_attendance'
        ];
    }
    
    return [
        'role' => $role,
        'permissions' => $permissions
    ];
}

// Handle authentication endpoint
if ($endpoint === 'login' || $endpoint === null) {
    try {
        $pdo = getDatabaseConnection();
        
        // Get credentials from request
        $method = $_SERVER['REQUEST_METHOD'];
        
        if ($method === 'POST') {
            $input = json_decode(file_get_contents('php://input'), true);
            $username = $input['username'] ?? null;
            $password = $input['password'] ?? null;
            $department = $input['department'] ?? null;
        } else {
            $username = $_GET['username'] ?? null;
            $password = $_GET['password'] ?? null;
            $department = $_GET['department'] ?? null;
        }
        
        // Validate required fields
        if (empty($username) || empty($password)) {
            sendErrorResponse('Username and password are required', 400);
        }
        
        if (empty($department)) {
            sendErrorResponse('Department is required', 400);
        }
        
        // Validate department
        $validDepartments = [
            'Human Resources',
            'Operation',
            'Finance',
            'Procurement',
            'Engineering',
            'super-admin'
        ];
        
        if (!in_array($department, $validDepartments)) {
            sendErrorResponse('Invalid department', 400);
        }
        
        // Build query
        $query = "SELECT * FROM emp_list WHERE username = :username";
        $params = [':username' => $username];
        
        if ($department !== 'super-admin') {
            $query .= " AND department = :department";
            $params[':department'] = $department;
        }
        
        // Execute query
        $stmt = $pdo->prepare($query);
        $stmt->execute($params);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        
        if (!$user) {
            sendErrorResponse('User not found or not authorized for this department', 404);
        }
        
        // Verify password
        if (!password_verify($password, $user['password_hash'])) {
            sendErrorResponse('Invalid credentials', 401);
        }
        
        // Get role and permissions
        $roleData = getUserRoleAndPermissions($user, $department);
        
        // Prepare user data
        $userData = [
            'id' => $user['uid'],
            'name' => trim($user['first_name'] . ' ' . $user['last_name']),
            'username' => $username,
            'access_level' => $user['access_level'],
            'department' => $user['department'],
            'role' => $roleData['role'],
            'permissions' => $roleData['permissions']
        ];
        
        sendSuccessResponse(['user' => $userData]);
        
    } catch (PDOException $e) {
        sendErrorResponse('Authentication failed', 500, ['message' => $e->getMessage()]);
    }
} else {
    sendErrorResponse('Invalid auth endpoint', 404);
}
?>