using System;
using System.IO;
using System.Diagnostics;
using System.Drawing;
using System.Net;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;

class MonitorTray : ApplicationContext {
    NotifyIcon icon; Process child; string root, url, token; bool closing; System.Windows.Forms.Timer timer;
    class LocalClient : WebClient {protected override WebRequest GetWebRequest(Uri uri){var r=base.GetWebRequest(uri);r.Timeout=700;return r;}}
    public static string Root;
    [STAThread] static void Main(string[] args) {
        Root=AppDomain.CurrentDomain.BaseDirectory;
        Application.EnableVisualStyles();
        bool first;
        var config=new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(File.ReadAllText(Path.Combine(Root,File.Exists(Path.Combine(Root,"config.json"))?"config.json":"config.example.json")));
        using(var mutex=new Mutex(true,"Local\\OpenCodeMonitor-"+Environment.UserName+"-"+config["port"],out first)) {
            if(!first)return;
            try {Application.Run(new MonitorTray());}
            catch(Exception e){try{Directory.CreateDirectory(Path.Combine(Root,"data"));File.WriteAllText(Path.Combine(Root,"data","startup-error.txt"),e.Message);}catch{}MessageBox.Show(e.Message,"OpenCode Monitor",MessageBoxButtons.OK,MessageBoxIcon.Error);}
        }
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
        menu.Items.Add("打开监控界面",null,(s,e)=>Open());
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
    void Status(){try{MessageBox.Show(Read("/api/health"),"OpenCode Monitor 状态");}catch(Exception e){MessageBox.Show(e.Message,"OpenCode Monitor 状态");}}
    void Quit(){
        if(closing)return;closing=true;
        try{if(child==null||!child.HasExited)using(var c=new LocalClient()){c.Proxy=null;c.Headers["Authorization"]="Bearer "+token;c.UploadString(url+"/api/shutdown","POST","");}
            if(child!=null&&!child.WaitForExit(10000))child.Kill();
        }catch(Exception e){Log(e.Message);if(child!=null&&!child.HasExited)child.Kill();}
        icon.Visible=false;icon.Dispose();try{File.Delete(Path.Combine(root,"data","tray.pid"));}catch{}ExitThread();
    }
}
