# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
# Logbook (D90): the app's own plugin, found by name and its commands by their annotations. Tauri's
# library keeps @TauriPlugin classes already; this is insurance for the annotations themselves.
-keepattributes RuntimeVisibleAnnotations,AnnotationDefault
-keep class app.logbookjournal.android.LogbookPlugin {
  public <init>(android.app.Activity);
  @app.tauri.annotation.Command public <methods>;
}
-keep class app.logbookjournal.android.DocumentArgs { *; }
-keep class app.logbookjournal.android.CloseArgs { *; }
