-- Segunda parte de add_role_redactor_user_flags (ver comentario allí).
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'REDACTOR';
