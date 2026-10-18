using System;
using System.IO;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;

// A user-session accessibility event subscription, not a process polling service.
// Owned by an OpenCode plugin host. It remains available after Monitor is quit,
// so the next desktop application launch can start a new Monitor instance.
class OpenCodeWindowHook {
    delegate void WinEvent(IntPtr hook,uint evt,IntPtr window,int obj,int child,uint thread,uint time);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min,uint max,IntPtr module,WinEvent callback,uint process,uint thread,uint flags);
    [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window,uint flags);
    static string root=AppDomain.CurrentDomain.BaseDirectory;
    static HashSet<string> allowed=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    static HashSet<string> seen=new HashSet<string>();
    static WinEvent callback=OnWindow;
    static void Log(string text){try{Directory.CreateDirectory(Path.Combine(root,"data"));File.AppendAllText(Path.Combine(root,"data","desktop-startup.log"),DateTime.UtcNow.ToString("o")+" "+text+Environment.NewLine);}catch{}}
    [STAThread] static void Main(string[] args){
        try{
            if(args.Length!=4||args[0]!="--parent"||args[2]!="--root")throw new Exception("Expected --parent PID --root INSTALL_DIR");
            root=Path.GetFullPath(args[3]);
            var parent=Process.GetProcessById(Int32.Parse(args[1]));
            var cfg=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(root,"config.json")));
            bool first;
            using(var mutex=new Mutex(true,"Local\\OpenCodeMonitorWindowHook-"+Environment.UserName+"-"+cfg["port"],out first)){
                if(!first)return;
                allowed.Add(Path.GetFullPath(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","@opencodedesktop","OpenCode.exe")));
                object configured;if(cfg.TryGetValue("desktopExecutables",out configured))foreach(var value in (System.Collections.IEnumerable)configured)allowed.Add(Path.GetFullPath((string)value));
                using(var context=new ApplicationContext()){
                    // Force creation of a message-loop-owned handle before subscribing.
                    using(var control=new Control()){
                        var handle=control.Handle;
                        parent.EnableRaisingEvents=true;
                        parent.Exited+=(s,e)=>{try{control.BeginInvoke((Action)(()=>context.ExitThread()));}catch{}};
                        if(parent.HasExited)return;
                        // EVENT_OBJECT_SHOW, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS.
                        var hook=SetWinEventHook(0x8002,0x8002,IntPtr.Zero,callback,0,0,2);
                        if(hook==IntPtr.Zero)throw new Exception("Windows window event subscription failed");
                        Log("ready parent="+parent.Id+" pid="+Process.GetCurrentProcess().Id);
                        File.WriteAllText(Path.Combine(root,"data","window-hook.pid"),Process.GetCurrentProcess().Id.ToString());
                        try{Application.Run(context);}finally{UnhookWinEvent(hook);try{File.Delete(Path.Combine(root,"data","window-hook.pid"));}catch{}Log("stopped parent="+parent.Id);}
                    }
                }
            }
        }catch(Exception e){Log("error "+e.Message);MessageBox.Show(e.Message,"OpenCode Monitor desktop startup",MessageBoxButtons.OK,MessageBoxIcon.Error);}
    }
    static void OnWindow(IntPtr hook,uint evt,IntPtr window,int obj,int child,uint thread,uint time){
        if(window==IntPtr.Zero||obj!=0||child!=0||GetAncestor(window,2)!=window)return;
        try{
            uint pid;GetWindowThreadProcessId(window,out pid);
            using(var process=Process.GetProcessById((int)pid)){
                if(!process.ProcessName.Equals("OpenCode",StringComparison.OrdinalIgnoreCase))return;
                var executable=process.MainModule.FileName;if(!allowed.Contains(Path.GetFullPath(executable)))return;
                var identity=pid+":"+process.StartTime.ToUniversalTime().Ticks;
                if(!seen.Add(identity))return;
                // The tray's named mutex handles races with the plugin and repeated launches.
                var start=new ProcessStartInfo(Path.Combine(root,"MonitorTray.exe"));start.WorkingDirectory=root;start.UseShellExecute=false;start.CreateNoWindow=true;
                Process.Start(start);Log("desktop_open pid="+pid);
            }
        }catch(Exception e){Log("window event: "+e.Message);}
    }
}
