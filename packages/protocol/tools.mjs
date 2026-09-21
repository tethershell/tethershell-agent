import {z} from 'zod';
const path=z.string().min(1).max(1024);
const position=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const sessionId=z.string().uuid();
const wait=z.number().int().min(0).max(5000).default(1000);
const processSchema=z.object({command:z.string().min(1).max(8192),wait_ms:wait,timeout_ms:z.number().int().min(100).max(86400000).optional()});
export const tools={
 list_files:{description:'List up to 200 workspace directory entries.',schema:z.object({path:path.default('.')}),readOnly:true},
 read_file:{description:'Read a file page using byte offset and length (up to 64 KiB). Continue with nextOffset; pass version as expectedVersion to detect changes. Use base64 for binary files or exact byte reconstruction.',schema:z.object({path,offset:position.default(0),length:z.number().int().min(1).max(65536).default(65536),encoding:z.enum(['utf8','base64']).default('utf8'),expectedVersion:z.string().max(200).optional()}),readOnly:true},
 write_file:{description:'Write a UTF-8 chunk up to 64 KiB. mode overwrite replaces the file; append adds a chunk. For sequential appends pass expectedSize equal to the preceding file size. Never blindly retry an uncertain write.',schema:z.object({path,content:z.string().max(65536),mode:z.enum(['overwrite','append']).default('overwrite'),expectedSize:position.optional()}),readOnly:false},
 run_command:{description:'Run a command and return a process session after wait_ms (0–5000 ms). It continues in the background. Use read_process_output, interact_with_process and terminate_process. Default lifetime one hour, subject to local limits. Shell commands have agent OS permissions.',schema:processSchema,readOnly:false,openWorld:true},
 start_process:{description:'Start a background or interactive shell process. Returns sessionId and initial output after wait_ms; this wait does not kill it. Default lifetime one hour, subject to local limits. Requires local command permission.',schema:processSchema,readOnly:false,openWorld:true},
 list_sessions:{description:'List process session IDs, status, exit codes and output ranges on this device. Sessions last until agent restart or retention expiry.',schema:z.object({}),readOnly:true},
 read_process_output:{description:'Read process output with absolute byte offset and length, up to 64 KiB. Continue with nextOffset. Includes status. Output is a rolling buffer: truncated/droppedBytes indicate evicted bytes. Use base64 for exact bytes.',schema:z.object({sessionId,offset:position.default(0),length:z.number().int().min(1).max(65536).default(65536),encoding:z.enum(['utf8','base64']).default('utf8')}),readOnly:true},
 interact_with_process:{description:'Send input to an existing process, including newline when needed. Set eof to close stdin. Returns new output after wait_ms. Input can cause arbitrary side effects; never automatically retry.',schema:z.object({sessionId,input:z.string().max(16384).default(''),eof:z.boolean().default(false),wait_ms:wait}),readOnly:false,openWorld:true},
 terminate_process:{description:'Terminate a process session and its process group. Partial side effects are not rolled back.',schema:z.object({sessionId}),readOnly:false}
};
export const deviceIdSchema=z.string().uuid();
export const MAX_OUTPUT=65536;
