using System;
using System.IO;
using System.Diagnostics;
using System.Drawing;
using System.Net;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Win32;
using System.Text.RegularExpressions;

class MonitorTray : ApplicationContext {
    NotifyIcon icon; Process child; string root, url, token; bool closing; System.Windows.Forms.Timer timer;
    class LocalClient : WebClient {protected override WebRequest GetWebRequest(Uri uri){var r=base.GetWebRequest(uri);r.Timeout=700;return r;}}
    public static string Root;
    [STAThread] static void Main(string[] args) {
        Root=AppDomain.CurrentDomain.BaseDirectory;
        if(args.Length>2&&args[0]=="--apply-update"){RunUpdateHelper(args);return;}
        Application.EnableVisualStyles();
        bool first;
        var config=new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(File.ReadAllText(Path.Combine(Root,File.Exists(Path.Combine(Root,"config.json"))?"config.json":"config.example.json")));
        using(var mutex=new Mutex(true,"Local\\OpenCodeMonitor-"+Environment.UserName+"-"+config["port"],out first)) {
            if(!first)return;
            try {Application.Run(new MonitorTray());}
            catch(Exception e){try{Directory.CreateDirectory(Path.Combine(Root,"data"));File.WriteAllText(Path.Combine(Root,"data","startup-error.txt"),e.Message);}catch{}MessageBox.Show(e.Message,"OpenCode Monitor",MessageBoxButtons.OK,MessageBoxIcon.Error);}
        }
    }
    static void RunUpdateHelper(string[] args){
        string log=args[1];
        try{
            var quoted=new System.Collections.Generic.List<string>();for(int i=2;i<args.Length;i++)quoted.Add("\""+args[i]+"\"");
            var info=new ProcessStartInfo("powershell.exe",String.Join(" ",quoted.ToArray()));info.UseShellExecute=false;info.CreateNoWindow=true;info.RedirectStandardOutput=true;info.RedirectStandardError=true;
            using(var process=new Process()){
                process.StartInfo=info;var gate=new object();DataReceivedEventHandler write=(s,e)=>{if(e.Data!=null)try{lock(gate)File.AppendAllText(log,e.Data+Environment.NewLine);}catch{}};
                process.OutputDataReceived+=write;process.ErrorDataReceived+=write;process.Start();process.BeginOutputReadLine();process.BeginErrorReadLine();process.WaitForExit();Environment.ExitCode=process.ExitCode;
            }
        }catch(Exception e){try{File.AppendAllText(log,"Update launcher: "+e.Message+Environment.NewLine);}catch{}Environment.ExitCode=1;}
    }
    string Read(string path){using(var c=new LocalClient()){c.Proxy=null;return c.DownloadString(url+path);}}
    MonitorTray(){
        root=Root;
        var json=new JavaScriptSerializer();
        var cfg=json.Deserialize<System.Collections.Generic.Dictionary<string,object>>(File.ReadAllText(Path.Combine(root,File.Exists(Path.Combine(root,"config.json"))?"config.json":"config.example.json")));
        url="http://127.0.0.1:"+cfg["port"];
        icon=new NotifyIcon();icon.Icon=SystemIcons.Application;icon.Text="OpenCode Monitor: starting";icon.Visible=true;
        icon.MouseClick+=(s,e)=>{Log("Tray click "+e.Button);if(e.Button==MouseButtons.Left)Open();};
        var menu=new ContextMenuStrip();
        menu.Items.Add("打开监控界面（默认浏览器）",null,(s,e)=>Open());
        menu.Items.Add("打开 App 窗口",null,(s,e)=>OpenApp());
        menu.Items.Add("状态",null,(s,e)=>Status());
        menu.Items.Add("退出监控器",null,(s,e)=>Quit());icon.ContextMenuStrip=menu;
        menu.Opening+=(s,e)=>Log("Tray menu opened");
        try {
            bool running=false;
            try{Validate(Read("/api/health"));running=true;}catch(WebException e){if(e.Response!=null)throw new Exception("端口已被其他应用占用："+url);}
            if(!running){
                string node=Path.Combine(root,"runtime","node.exe");if(!File.Exists(node))node="node.exe";
                var info=new ProcessStartInfo(node,"\""+Path.Combine(root,"server.mjs")+"\"");
                info.WorkingDirectory=root;info.UseShellExecute=false;info.CreateNoWindow=true;
                info.RedirectStandardOutput=true;info.RedirectStandardError=true;
                Directory.CreateDirectory(Path.Combine(root,"data"));
                child=new Process();child.StartInfo=info;
                child.OutputDataReceived+=(s,e)=>Log(e.Data);child.ErrorDataReceived+=(s,e)=>Log(e.Data);
                child.Start();child.BeginOutputReadLine();child.BeginErrorReadLine();
                bool ready=false;
                for(int i=0;i<100;i++){
                    if(child.HasExited)throw new Exception("监控器启动失败，参阅 data/tray.log");
                    try{Validate(Read("/api/health"));ready=true;break;}catch(WebException){}
                    Thread.Sleep(100);
                }
                if(!ready)throw new Exception("监控器启动超时，参阅 data/tray.log");
            }
            token=File.ReadAllText(Path.Combine(root,"data","control.token")).Trim();
            icon.Text="OpenCode Monitor: running";
            File.WriteAllText(Path.Combine(root,"data","tray.pid"),Process.GetCurrentProcess().Id.ToString());
            timer=new System.Windows.Forms.Timer();timer.Interval=1000;
            int failures=0;
            timer.Tick+=(s,e)=>{if(child!=null&&child.HasExited){Quit();return;}try{Validate(Read("/api/health"));failures=0;icon.Text="OpenCode Monitor: running";}catch{icon.Text="OpenCode Monitor: offline";if(++failures>=2){timer.Stop();Quit();}}};timer.Start();
        }catch{icon.Visible=false;icon.Dispose();if(child!=null&&!child.HasExited)child.Kill();throw;}
    }
    void Validate(string health){
        var d=new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(health);
        if(!d.ContainsKey("app")||(string)d["app"]!="opencode-monitor"||!String.Equals(Path.GetFullPath((string)d["root"]).TrimEnd('\\','/'),Path.GetFullPath(root).TrimEnd('\\','/'),StringComparison.OrdinalIgnoreCase))throw new Exception("端口已被其他监控实例或应用占用："+url);
    }
    void Log(string s){if(s!=null)try{lock(this)File.AppendAllText(Path.Combine(root,"data","tray.log"),s+Environment.NewLine);}catch{}}
    void Open(){try{Process.Start(new ProcessStartInfo(url){UseShellExecute=true});}catch(Exception e){MessageBox.Show(e.Message,"OpenCode Monitor");}}
    void OpenApp(){
        try{
            string browser=null;
            var prog=Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice","ProgId",null) as string;
            if(prog!=null)using(var key=Registry.ClassesRoot.OpenSubKey(prog+@"\shell\open\command")){
                var command=key==null?null:key.GetValue(null) as string;
                var match=Regex.Match(command??"","^\"([^\"]+)\"");
                if(match.Success){var exe=match.Groups[1].Value;var leaf=Path.GetFileName(exe);if(leaf.Equals("chrome.exe",StringComparison.OrdinalIgnoreCase)||leaf.Equals("msedge.exe",StringComparison.OrdinalIgnoreCase))browser=exe;}
            }
            if(browser==null){foreach(var folder in new[]{Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles)}){var exe=Path.Combine(folder,"Microsoft","Edge","Application","msedge.exe");if(File.Exists(exe)){browser=exe;break;}}}
            if(browser==null){Open();return;}
            var info=new ProcessStartInfo(browser,"--app=\""+url+"\" --user-data-dir=\""+Path.Combine(root,"data","app-profile")+"\" --no-first-run --no-default-browser-check");info.UseShellExecute=false;Process.Start(info);
        }catch(Exception e){MessageBox.Show(e.Message,"OpenCode Monitor");}
    }
    void Status(){try{MessageBox.Show(Read("/api/health"),"OpenCode Monitor 状态");}catch(Exception e){MessageBox.Show(e.Message,"OpenCode Monitor 状态");}}
    void Quit(){
        if(closing)return;closing=true;
        try{if(child==null||!child.HasExited)using(var c=new LocalClient()){c.Proxy=null;c.Headers["Authorization"]="Bearer "+token;c.UploadString(url+"/api/shutdown","POST","");}
            if(child!=null&&!child.WaitForExit(10000))child.Kill();
        }catch(Exception e){Log(e.Message);if(child!=null&&!child.HasExited)child.Kill();}
        icon.Visible=false;icon.Dispose();try{File.Delete(Path.Combine(root,"data","tray.pid"));}catch{}ExitThread();
    }
}
