function v = ifcAlloc(u)
%IFCALLOC 解释型 MATLAB Fcn 块包装：差速轮速分配（式 8.3–8.5）。
% 输入 u = PD 输出标量；输出 v = [vL_cmd; vR_cmd]（限幅 [0, vMax]）。
% 参数 vBase/vMax/w 读 base 工作区 P。
P = evalin('base','P');
a = abs(u);
dvOut = 2*a/(1+P.w);
dvIn  = 2*a*P.w/(1+P.w);
if u >= 0
    vL = P.vBase + dvOut;   % 右转：左外右内
    vR = P.vBase - dvIn;
else
    vR = P.vBase + dvOut;   % 左转反之
    vL = P.vBase - dvIn;
end
v = [min(max(vL,0),P.vMax); min(max(vR,0),P.vMax)];
end
