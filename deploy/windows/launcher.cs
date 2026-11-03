using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;

namespace PrusaLapseLauncher
{
    class Program
    {
        static void Main(string[] args)
        {
            Console.Title = "PrusaLapse Portable";
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("================================================================");
            Console.WriteLine("                    PRUSALAPSE PORTABLE (WINDOWS)               ");
            Console.WriteLine("================================================================");
            Console.ResetColor();
            Console.WriteLine();

            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string runtimeNode = Path.Combine(baseDir, "runtime", "node.exe");
            string rootNode = Path.Combine(baseDir, "node.exe");
            string nodeExe = File.Exists(runtimeNode) ? runtimeNode : (File.Exists(rootNode) ? rootNode : "node");

            string serverScript = Path.Combine(baseDir, "app", "server.js");
            if (!File.Exists(serverScript))
            {
                serverScript = Path.Combine(baseDir, "server.js");
            }

            if (!File.Exists(serverScript))
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("[ERROR] Could not find server.js at: " + serverScript);
                Console.ResetColor();
                Console.WriteLine("Press any key to exit...");
                Console.ReadKey();
                return;
            }

            // Setup environment variables
            Environment.SetEnvironmentVariable("PORT", "3000");
            Environment.SetEnvironmentVariable("HOSTNAME", "0.0.0.0");
            Environment.SetEnvironmentVariable("NODE_ENV", "production");

            string binFfmpeg = Path.Combine(baseDir, "bin", "ffmpeg.exe");
            if (File.Exists(binFfmpeg))
            {
                Environment.SetEnvironmentVariable("FFMPEG_PATH", binFfmpeg);
            }

            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.FileName = nodeExe;
            startInfo.Arguments = "\"" + serverScript + "\"";
            startInfo.WorkingDirectory = Path.GetDirectoryName(serverScript);
            startInfo.UseShellExecute = false;
            startInfo.RedirectStandardOutput = false;
            startInfo.RedirectStandardError = false;

            Process serverProcess = null;
            try
            {
                Console.ForegroundColor = ConsoleColor.Green;
                Console.WriteLine("[INFO] Starting PrusaLapse server...");
                Console.ResetColor();

                serverProcess = Process.Start(startInfo);
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("[ERROR] Failed to start server: " + ex.Message);
                Console.ResetColor();
                Console.WriteLine("Press any key to exit...");
                Console.ReadKey();
                return;
            }

            // Launch browser thread
            new Thread(() =>
            {
                // Wait up to 15 seconds for server to respond on port 3000
                bool ready = false;
                for (int i = 0; i < 30; i++)
                {
                    Thread.Sleep(500);
                    try
                    {
                        HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:3000/api/config");
                        req.Timeout = 1000;
                        using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                        {
                            if (resp.StatusCode == HttpStatusCode.OK)
                            {
                                ready = true;
                                break;
                            }
                        }
                    }
                    catch { }
                }

                Console.ForegroundColor = ConsoleColor.Yellow;
                Console.WriteLine();
                Console.WriteLine("================================================================");
                Console.WriteLine("  PrusaLapse is active and ready at: http://localhost:3000      ");
                Console.WriteLine("  Opening your browser now...                                   ");
                Console.WriteLine("  Keep this window open while using PrusaLapse.                 ");
                Console.WriteLine("================================================================");
                Console.WriteLine();
                Console.ResetColor();

                try
                {
                    Process.Start(new ProcessStartInfo("http://localhost:3000") { UseShellExecute = true });
                }
                catch { }
            }).Start();

            // Wait for server to terminate
            if (serverProcess != null)
            {
                serverProcess.WaitForExit();
            }
        }
    }
}
