# F3Go30 Spreadsheet Reference

Source: https://docs.google.com/spreadsheets/d/1cmAekgTovvQFPjKQtINNC735sPKsW80TU2T8e8CyWxA/edit

---

## Sheet: Tracker

- **Visibility:** visible
- **Dimensions:** 4 rows × 49 columns
- **Frozen panes:** 3 row(s), 1 column(s)
- **Tab color:** #00FF00
- **Merged regions (1):** H1:AW1

### Row 1

- A:  
- B: =NOW()
- H: =LET(
  total, COUNTA(Inspiration!A:A) - 1,
  secondsSinceMidnight, MOD(NOW(), 1) * 86400,
  idx, MOD(INT(secondsSinceMidnight / 10), total) + 2,
  INDEX(Inspiration!A:A, idx) & " -- " & INDEX(Inspiration!B:B, idx)
)


### Row 2

- A: Period
- P: 1.0
- X: 2.0
- AF: 3.0
- AN: 4.0
- AR: 5.0

### Row 3 (sample / template)

- A3: F3 Name
- B3: =IFNA(VLookup($A$3:$A4,'Goals by HIM'!A:B,2,0),"")
- C3: =Controls!$A$3
- D3: =Controls!$A$4
- E3: Inspire
- F3: =Controls!$A$2
- G3: Raw Score
- H3: Score
- I3: 2026-03-01 00:00:00
- J3: 2026-03-02 00:00:00
- K3: 2026-03-03 00:00:00
- L3: 2026-03-04 00:00:00
- M3: 2026-03-05 00:00:00
- N3: 2026-03-06 00:00:00
- O3: 2026-03-07 00:00:00
- P3: Bonus
- Q3: 2026-03-08 00:00:00
- R3: 2026-03-09 00:00:00
- S3: 2026-03-10 00:00:00
- T3: 2026-03-11 00:00:00
- U3: 2026-03-12 00:00:00
- V3: 2026-03-13 00:00:00
- W3: 2026-03-14 00:00:00
- X3: Bonus

### Formulas (21 unique)

```
B1: =NOW()
H1: =LET(
  total, COUNTA(Inspiration!A:A) - 1,
  secondsSinceMidnight, MOD(NOW(), 1) * 86400,
  idx, MOD(INT(secondsSinceMidnight / 10), total) + 2,
  INDEX(Inspiration!A:A, idx) & " -- " & INDEX(Inspiration!B:B, idx)
)

B3: =IFNA(VLookup($A$3:$A4,'Goals by HIM'!A:B,2,0),"")
C3: =Controls!$A$3
D3: =Controls!$A$4
F3: =Controls!$A$2
C4: =SUMIFS(UBonus_Multiplier,UBonus_Name,$A4,UBonus_Type,C$3)
D4: =SUMIFS(UBonus_Multiplier,UBonus_Name,$A4,UBonus_Type,D$3)
E4: =SUMIFS(UBonus_Multiplier,UBonus_Name,$A4,UBonus_Type,E$3)
F4: =SUMIFS(UBonus_Multiplier,UBonus_Name,$A4,UBonus_Type,F$3)
G4: =SUMIF(SDTracker_Data_Header,"<>Bonus",I4:AS4)
H4: =SUM($I4:$AS4)
P4: =SUMIFS(UBonus_Multiplier,UBonus_Name,$A4,UBonus_Period,P$2,UBonus_Complete,TRUE)
X4: =SUMIFS(UBonus_Multiplier,UBonus_Name,$A4,UBonus_Period,X$2,UBonus_Complete,TRUE)
AF4: =SUMIFS(UBonus_Multiplier,UBonus_Name,$A4,UBonus_Period,AF$2,UBonus_Complete,TRUE)
AN4: =SUMIFS(UBonus_Multiplier,UBonus_Name,$A4,UBonus_Period,AN$2,UBonus_Complete,TRUE)
AR4: =SUMIFS(UBonus_Multiplier,UBonus_Name,$A4,UBonus_Period,AR$2,UBonus_Complete,TRUE)
AT4: =SUMIFS(UBonus_Multiplier,UBonus_Name,$A4,UBonus_Type,AT$3,UBonus_Complete,True)
AU4: =SUMIFS(UBonus_Multiplier,UBonus_Name,$A4,UBonus_Type,AU$3,UBonus_Complete,True)
AV4: =SUMIFS(UBonus_Multiplier,UBonus_Name,$A4,UBonus_Type,AV$3,UBonus_Complete,True)
AW4: =SUMIFS(UBonus_Multiplier,UBonus_Name,$A4,UBonus_Type,AW$3,UBonus_Complete,True)
```

### Hidden columns: AS, C

---

## Sheet: Config

- **Visibility:** hidden
- **Dimensions:** 3 rows × 3 columns

### Row 1

- A: NameSpace
- B: T3 Go30

### Row 2

- A: Site Q
- B: Little John
- C: stu@asyn.com

### Row 3 (sample / template)

- A3: LogFile
- B3: https://drive.google.com/file/d/19CN6lyB8ksoAAubtfuTRCltpMIyy8ZWd/view?usp=drive_link

---

## Sheet: Inspiration

- **Visibility:** hidden
- **Dimensions:** 25 rows × 2 columns

### Row 1

- A: Quote
- B: Author

### Row 2

- A: You are either getting better or you are getting worse. You never stay the same.
- B: Pat Riley

### Row 3 (sample / template)

- A3: If you're not moving forward, you're falling back.
- B3: Sam Waterston

---

## Sheet: Status

- **Visibility:** hidden
- **Dimensions:** 1 rows × 1 columns

---

## Sheet: Bonus Tracker

- **Visibility:** visible
- **Dimensions:** 892 rows × 26 columns
- **Frozen panes:** 1 row(s), 1 column(s)
- **Tab color:** #9900FF

### Row 1

- A: Name
- B: ={"Period";IF(ISBLANK($A2:$A892),,Vlookup($G2:$G892,Periods!B:C,2,0))}
- C: =IF(ROW($C$1:$C892)=1,"Uncapped Points",IF($A$1:$A892="","",IF(VLOOKUP($F$1:$F892,Controls!$A$2:$D$5,4,FALSE),$I$1:$I892,"")))
- D: =IF(ROW($D$1:$D892)=1,"Multiplier",IF($F$1:$F892="","",VLOOKUP($F$1:$F892,Controls!$A$2:$B$5,2,FALSE)))
- E: =IF(ROW($E$1:$E892)=1,"Complete",IF($A$1:$A892="","",IF(VLOOKUP($F$1:$F892,Controls!$A$2:$C$5,3,False),IF(ISBLANK(I1:I892),FALSE,TRUE),TRUE)))
- F: Type
- G: When
- H: What/Where/Who
- I: Slack Link (hover cursor for instructions)

### Row 2

- C: 
- D: 
- E: 

### Row 3 (sample / template)

- C3: 
- D3: 
- E3: 

### Formulas (4 unique)

```
B1: ={"Period";IF(ISBLANK($A2:$A892),,Vlookup($G2:$G892,Periods!B:C,2,0))}
C1: =IF(ROW($C$1:$C892)=1,"Uncapped Points",IF($A$1:$A892="","",IF(VLOOKUP($F$1:$F892,Controls!$A$2:$D$5,4,FALSE),$I$1:$I892,"")))
D1: =IF(ROW($D$1:$D892)=1,"Multiplier",IF($F$1:$F892="","",VLOOKUP($F$1:$F892,Controls!$A$2:$B$5,2,FALSE)))
E1: =IF(ROW($E$1:$E892)=1,"Complete",IF($A$1:$A892="","",IF(VLOOKUP($F$1:$F892,Controls!$A$2:$C$5,3,False),IF(ISBLANK(I1:I892),FALSE,TRUE),TRUE)))
```

### Hidden columns: B, C, E, J

---

## Sheet: Periods

- **Visibility:** hidden
- **Dimensions:** 537 rows × 3 columns

### Row 1

- A: =IFERROR(__xludf.DUMMYFUNCTION("query(transpose(Tracker!C2:I3),""select Col1,Col2"",0)"),"")
- B: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46082.0)
- C: =WEEKNUM(B1, 1) - WEEKNUM(DATE(YEAR(B1), MONTH(B1), 1), 1)+1

### Row 2

- B: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46083.0)
- C: =WEEKNUM(B2, 1) - WEEKNUM(DATE(YEAR(B2), MONTH(B2), 1), 1)+1

### Row 3 (sample / template)

- B3: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46084.0)
- C3: =WEEKNUM(B3, 1) - WEEKNUM(DATE(YEAR(B3), MONTH(B3), 1), 1)+1

### Formulas (74 unique)

```
A1: =IFERROR(__xludf.DUMMYFUNCTION("query(transpose(Tracker!C2:I3),""select Col1,Col2"",0)"),"")
B1: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46082.0)
C1: =WEEKNUM(B1, 1) - WEEKNUM(DATE(YEAR(B1), MONTH(B1), 1), 1)+1
B2: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46083.0)
C2: =WEEKNUM(B2, 1) - WEEKNUM(DATE(YEAR(B2), MONTH(B2), 1), 1)+1
B3: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46084.0)
C3: =WEEKNUM(B3, 1) - WEEKNUM(DATE(YEAR(B3), MONTH(B3), 1), 1)+1
B4: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46085.0)
C4: =WEEKNUM(B4, 1) - WEEKNUM(DATE(YEAR(B4), MONTH(B4), 1), 1)+1
B5: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46086.0)
C5: =WEEKNUM(B5, 1) - WEEKNUM(DATE(YEAR(B5), MONTH(B5), 1), 1)+1
B6: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46087.0)
C6: =WEEKNUM(B6, 1) - WEEKNUM(DATE(YEAR(B6), MONTH(B6), 1), 1)+1
B7: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46088.0)
C7: =WEEKNUM(B7, 1) - WEEKNUM(DATE(YEAR(B7), MONTH(B7), 1), 1)+1
A8: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),1.0)
C8: =WEEKNUM(B8, 1) - WEEKNUM(DATE(YEAR(B8), MONTH(B8), 1), 1)+1
B9: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46089.0)
C9: =WEEKNUM(B9, 1) - WEEKNUM(DATE(YEAR(B9), MONTH(B9), 1), 1)+1
B10: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46090.0)
C10: =WEEKNUM(B10, 1) - WEEKNUM(DATE(YEAR(B10), MONTH(B10), 1), 1)+1
B11: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46091.0)
C11: =WEEKNUM(B11, 1) - WEEKNUM(DATE(YEAR(B11), MONTH(B11), 1), 1)+1
B12: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46092.0)
C12: =WEEKNUM(B12, 1) - WEEKNUM(DATE(YEAR(B12), MONTH(B12), 1), 1)+1
B13: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46093.0)
C13: =WEEKNUM(B13, 1) - WEEKNUM(DATE(YEAR(B13), MONTH(B13), 1), 1)+1
B14: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46094.0)
C14: =WEEKNUM(B14, 1) - WEEKNUM(DATE(YEAR(B14), MONTH(B14), 1), 1)+1
B15: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46095.0)
C15: =WEEKNUM(B15, 1) - WEEKNUM(DATE(YEAR(B15), MONTH(B15), 1), 1)+1
A16: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),2.0)
C16: =WEEKNUM(B16, 1) - WEEKNUM(DATE(YEAR(B16), MONTH(B16), 1), 1)+1
B17: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46096.0)
C17: =WEEKNUM(B17, 1) - WEEKNUM(DATE(YEAR(B17), MONTH(B17), 1), 1)+1
B18: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46097.0)
C18: =WEEKNUM(B18, 1) - WEEKNUM(DATE(YEAR(B18), MONTH(B18), 1), 1)+1
B19: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46098.0)
C19: =WEEKNUM(B19, 1) - WEEKNUM(DATE(YEAR(B19), MONTH(B19), 1), 1)+1
B20: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46099.0)
C20: =WEEKNUM(B20, 1) - WEEKNUM(DATE(YEAR(B20), MONTH(B20), 1), 1)+1
B21: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46100.0)
C21: =WEEKNUM(B21, 1) - WEEKNUM(DATE(YEAR(B21), MONTH(B21), 1), 1)+1
B22: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46101.0)
C22: =WEEKNUM(B22, 1) - WEEKNUM(DATE(YEAR(B22), MONTH(B22), 1), 1)+1
B23: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46102.0)
C23: =WEEKNUM(B23, 1) - WEEKNUM(DATE(YEAR(B23), MONTH(B23), 1), 1)+1
A24: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),3.0)
C24: =WEEKNUM(B24, 1) - WEEKNUM(DATE(YEAR(B24), MONTH(B24), 1), 1)+1
B25: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46103.0)
C25: =WEEKNUM(B25, 1) - WEEKNUM(DATE(YEAR(B25), MONTH(B25), 1), 1)+1
B26: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46104.0)
C26: =WEEKNUM(B26, 1) - WEEKNUM(DATE(YEAR(B26), MONTH(B26), 1), 1)+1
B27: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46105.0)
C27: =WEEKNUM(B27, 1) - WEEKNUM(DATE(YEAR(B27), MONTH(B27), 1), 1)+1
B28: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46106.0)
C28: =WEEKNUM(B28, 1) - WEEKNUM(DATE(YEAR(B28), MONTH(B28), 1), 1)+1
B29: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46107.0)
C29: =WEEKNUM(B29, 1) - WEEKNUM(DATE(YEAR(B29), MONTH(B29), 1), 1)+1
B30: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),46108.0)
... and 14 more
```

---

## Sheet: Controls

- **Visibility:** hidden
- **Dimensions:** 5 rows × 7 columns

### Row 1

- A: Bonus Type
- B: Multiplier
- C: Link Required?
- D: Uncapped?
- E: Variable Names
- G: Names

### Row 2

- A: EHing FNG
- B: 5.0
- C: True
- D: True
- E: Bonus
- G: =Text(#REF!,"MMMM")

### Row 3 (sample / template)

- A3: Fellowship
- B3: 1.0
- C3: False
- D3: False

### Formulas (1 unique)

```
G2: =Text(#REF!,"MMMM")
```

---

## Sheet: Team Score

- **Visibility:** visible
- **Dimensions:** 50 rows × 7 columns
- **Tab color:** #0000FF

### Row 1

- A: =IFERROR(__xludf.DUMMYFUNCTION("QUERY(QUERY(Tracker!$A$3:G$79,""SELECT B, COUNT(B), AVG(H), AVG(G), AVG(C), AVG(D), AVG(E), AVG(F) GROUP BY B"",1),""SELECT Col1, Col3, Col4, Col5, Col6, Col7, Col8 WHERE Col2 > 1 ORDER BY Col3 DESC LABEL Col3  'Score', Col4 'Raw Score', Col5 'Fellowship'"&", Col6 'Q-Point', Col7 'Inspire', Col8 'EHing FNG'"",1)
"),"Team")
- B: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Score")
- C: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Raw Score")
- D: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Fellowship")
- E: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Q-Point")
- F: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Inspire")
- G: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"EHing FNG")

### Formulas (7 unique)

```
A1: =IFERROR(__xludf.DUMMYFUNCTION("QUERY(QUERY(Tracker!$A$3:G$79,""SELECT B, COUNT(B), AVG(H), AVG(G), AVG(C), AVG(D), AVG(E), AVG(F) GROUP BY B"",1),""SELECT Col1, Col3, Col4, Col5, Col6, Col7, Col8 WHERE Col2 > 1 ORDER BY Col3 DESC LABEL Col3  'Score', Col4 'Raw Score', Col5 'Fellowship'"&", Col6 'Q-Point', Col7 'Inspire', Col8 'EHing FNG'"",1)
"),"Team")
B1: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Score")
C1: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Raw Score")
D1: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Fellowship")
E1: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Q-Point")
F1: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Inspire")
G1: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"EHing FNG")
```

---

## Sheet: HIM Score

- **Visibility:** visible
- **Dimensions:** 26 rows × 12 columns
- **Tab color:** #6AA84F

### Row 1

- A: =IFERROR(__xludf.DUMMYFUNCTION("QUERY(Tracker!$A$3:Z$29,""SELECT A, C, D, E, F, G, H ORDER BY H DESC"", 1)"),"F3 Name")
- B: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Fellowship")
- C: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Q Point")
- D: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Inspire")
- E: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"EHing FNG")
- F: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Raw Score")
- G: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Score")

### Row 2

- B: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),0.0)
- C: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),0.0)
- D: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),0.0)
- E: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),0.0)
- F: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),0.0)
- G: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),0.0)

### Formulas (8 unique)

```
A1: =IFERROR(__xludf.DUMMYFUNCTION("QUERY(Tracker!$A$3:Z$29,""SELECT A, C, D, E, F, G, H ORDER BY H DESC"", 1)"),"F3 Name")
B1: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Fellowship")
C1: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Q Point")
D1: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Inspire")
E1: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"EHing FNG")
F1: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Raw Score")
G1: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Score")
B2: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),0.0)
```

---

## Sheet: Goals by HIM

- **Visibility:** visible
- **Dimensions:** 70 rows × 17 columns
- **Frozen panes:** 1 row(s), 1 column(s)
- **Tab color:** #FF0000

### Row 1

- A: =IFERROR(__xludf.DUMMYFUNCTION("QUERY(Responses!$A1:$L70,""select D, F, H, I, J, K where D IS NOT NULL ORDER BY D, F"",1)"),"F3 Name")
- B: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Team")
- C: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"WHO do you ultimately want to become?")
- D: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"WHAT is your Go30 Challenge?")
- E: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"HOW are you going to be successful this month?")
- F: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Cell Phone Number")

### Formulas (6 unique)

```
A1: =IFERROR(__xludf.DUMMYFUNCTION("QUERY(Responses!$A1:$L70,""select D, F, H, I, J, K where D IS NOT NULL ORDER BY D, F"",1)"),"F3 Name")
B1: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Team")
C1: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"WHO do you ultimately want to become?")
D1: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"WHAT is your Go30 Challenge?")
E1: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"HOW are you going to be successful this month?")
F1: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Cell Phone Number")
```

---

## Sheet: UBonus Tracker

- **Visibility:** hidden
- **Dimensions:** 200 rows × 6 columns
- **Frozen panes:** 1 row(s), 0 column(s)

### Row 1

- A: =unique('Bonus Tracker'!A:F)
- B: Period
- C: Uncapped Points
- D: Multiplier
- E: Complete
- F: Type

### Row 2

- C: 
- D: 
- E: 

### Formulas (1 unique)

```
A1: =unique('Bonus Tracker'!A:F)
```

### Hidden rows: 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 30, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200

---

## Sheet: Goals by AO

- **Visibility:** hidden
- **Dimensions:** 70 rows × 17 columns
- **Frozen panes:** 1 row(s), 1 column(s)
- **Tab color:** #FF0000

### Row 1

- A: =IFERROR(__xludf.DUMMYFUNCTION("QUERY('Responses old'!$A1:$L70,""select D, F, H, I, J, K where D IS NOT NULL ORDER BY F, D"",1)"),"F3 Name")
- B: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"AO")
- C: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"WHO do you ultimately want to become?")
- D: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"WHAT is your Go30 Challenge?")
- E: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"HOW are you going to be successful this month?")
- F: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Cell Phone Number")

### Formulas (6 unique)

```
A1: =IFERROR(__xludf.DUMMYFUNCTION("QUERY('Responses old'!$A1:$L70,""select D, F, H, I, J, K where D IS NOT NULL ORDER BY F, D"",1)"),"F3 Name")
B1: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"AO")
C1: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"WHO do you ultimately want to become?")
D1: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"WHAT is your Go30 Challenge?")
E1: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"HOW are you going to be successful this month?")
F1: =IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Cell Phone Number")
```

---

## Sheet: Responses

- **Visibility:** visible
- **Dimensions:** 1 rows × 15 columns
- **Frozen panes:** 1 row(s), 0 column(s)

### Row 1

- A: Timestamp
- B: Email Address
- C: Are you currently participating in Go30?
- D: F3 Name
- E: Do you want to be on an AO based team - OR- grouped with other HIMs around a common goal?
- F: Team
- G: Great! Here are some goals that other HIM's are focused on this month. Pick one or choose 'other' and we will try and pair you with someone else who has a similar goal. Or specify another team name for grouping
- H: WHO do you ultimately want to become?
- I: WHAT is your Go30 Challenge?
- J: HOW are you going to be successful this month?
- K: Cell Phone Number
- L: Constructive Comments
- M: Success Story
- N: Column 13
- O: Column 13

---

## Sheet: Help

- **Visibility:** visible
- **Dimensions:** 13 rows × 3 columns
- **Tab color:** #000000

### Row 1

- A: Here are resources to help you in Go30

### Row 3 (sample / template)

- A3: Instructions
- B3: https://www.youtube.com/watch?v=cjn2qCLiHZY&t=4s

---

## Sheet: Activity

- **Visibility:** hidden
- **Dimensions:** 494 rows × 4 columns

### Row 1

- A: Datetime
- B: User
- C: Message
- D: Sheetname

---

## Sheet: Responses old

- **Visibility:** hidden
- **Dimensions:** 2 rows × 13 columns
- **Frozen panes:** 1 row(s), 0 column(s)

### Row 1

- A: Timestamp
- B: Email Address
- C: Are you currently participating in Go30?
- D: F3 Name
- E: Do you want to be on an AO based team - OR- grouped with other HIMs around a common goal?
- F: AO
- G: Great! Here are some goals that other HIM's are focused on this month. Pick one or choose 'other' and we will try and pair you with someone else who has a similar goal.
- H: WHO do you ultimately want to become?
- I: WHAT is your Go30 Challenge?
- J: HOW are you going to be successful this month?
- K: Cell Phone Number
- L: Constructive Comments
- M: Success Story

---

## Sheet: Notes

- **Visibility:** hidden
- **Dimensions:** 1 rows × 2 columns

### Row 1

- A: Form link
- B: https://docs.google.com/forms/d/e/1FAIpQLScjx5g6hLToUsoPD9RDA2GVOgKxAE45zbGCiYe54yg0f6QgMg/viewform?usp=sf_link

---

## Sheet: Links old

- **Visibility:** visible
- **Dimensions:** 1000 rows × 6 columns

### Row 1

- A: Month
- B: ID
- C: Tracker
- D: HC Form
- E: Slack Channel
- F: Slack Canvas

### Row 2

- A: 2026-02-01 00:00:00
- B: 1nx098ZD3Z4VGsgkLM9jUNai-RgpWxoxDAU5ccMfCR00
- C: https://docs.google.com/spreadsheets/d/1nx098ZD3Z4VGsgkLM9jUNai-RgpWxoxDAU5ccMfCR00/edit?gid=887409035#gid=887409035
- D: https://docs.google.com/forms/d/e/1FAIpQLSfLAcWyXD8MHWsiiYGmqKIj9kX5_JIL5ReYF4J5nzogKPk6Yg/viewform
- E: https://app.slack.com/client/T78NKT50E/CBX48QS9X
- F: https://f3pugetsound.slack.com/docs/T78NKT50E/F076NL39880

### Row 3 (sample / template)

- A3: 2026-03-01 00:00:00
- B3: 1TqCvQeLmJM3YC9Mj9dfaxNvv5_rs0aYObsTHeQ3m7NU
- C3: https://tinyurl.com/2026-03F3Go30
- D3: https://tinyurl.com/2026-03F3Go30HC
- E3: https://app.slack.com/client/T78NKT50E/CBX48QS9X
- F3: https://f3pugetsound.slack.com/docs/T78NKT50E/F076NL39880

---

## Sheet: Sheet195

- **Visibility:** visible
- **Dimensions:** 1 rows × 1 columns

---

## Sheet: Copy of NextMonthLink

- **Visibility:** hidden
- **Dimensions:** 1 rows × 1 columns

### Row 1

- A: https://docs.google.com/forms/d/e/1FAIpQLScDN5IIIRc9mPPQj2-mguob5_M0gukY0TSqlWViLZ1V8lNdHw/viewform?usp=pp_url&entry.66141003=Yes&entry.1629603174=F3NAME&entry.2018725851=WHO&entry.1045926264=WHAT&entry.1112484341=HOW&entry.49089566=0000000000&entry.1018485054=Sasquatch

---
