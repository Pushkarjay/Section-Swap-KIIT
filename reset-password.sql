-- MySQL Password Reset Script
-- This will reset the root password to 'Pushkarjay'

-- First, we need to flush privileges
FLUSH PRIVILEGES;

-- Reset the root password
ALTER USER 'root'@'localhost' IDENTIFIED BY 'Pushkarjay';

-- For compatibility with older MySQL versions, also try:
-- UPDATE mysql.user SET authentication_string = PASSWORD('Pushkarjay') WHERE User = 'root' AND Host = 'localhost';

-- Flush privileges again to apply changes
FLUSH PRIVILEGES;

-- Show success message
SELECT 'Password reset successful! New password is: Pushkarjay' AS message;
